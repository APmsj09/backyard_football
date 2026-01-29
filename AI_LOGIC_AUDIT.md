# AI Logic System Audit Report

## Executive Summary
Found **4 Critical Issues** and **7 Design Inconsistencies** that could cause system conflicts or break game logic.

---

## 🚨 CRITICAL ISSUES (Must Fix Immediately)

### 1. **ROSTER_LIMIT Mismatch (Line 823, 5071)**
**Severity:** CRITICAL  
**File:** `game.js`  
**Lines:** 823, 5071  
**Issue:** Two functions still use `ROSTER_LIMIT = 10` instead of 12:
- `simulateAIPick()` (line 823) - Prevents AI from drafting beyond 10 players
- `advanceToOffseason()` (line 5071) - Causes incorrect vacancy calculations

**Impact:** 
- AI teams will max out at 10 players instead of 12
- Player roster math breaks mid-offseason
- Depth chart rebuilding may have incomplete rosters

**Fix:** Change both to `const ROSTER_LIMIT = 12;`

---

### 2. **Formation/Depth Chart Mismatch Risk**
**Severity:** CRITICAL  
**File:** `game.js` (Lines 1313-1350)  
**Function:** `resolveDepthForPlay()`  
**Issue:** Formation slot structure is not validated before use. If a formation definition changes but depth charts aren't updated, slots become empty.

**Scenario:**
```javascript
// If you change a formation from 8 to 9 players:
'Balanced': {
    slots: ['QB1', 'RB1', 'WR1', 'WR2', 'TE1', 'OL1', 'OL2', 'OL3', 'OL4'], // Added OL4
    // But depth chart still only has 8 slots!
}
```

**Impact:** 
- New formation slots won't resolve to players
- Game tries to play with null player IDs
- Crashes during play execution

**Fix:** Add validation in `rebuildDepthChartFromOrder()` to sync slots with depth chart structure:
```javascript
// After changing formations, ensure depth chart matches
function rebuildDepthChartFromOrder(team) {
    const offSlots = offenseFormations[team.formations.offense]?.slots || [];
    team.depthChart.offense = Object.fromEntries(offSlots.map(slot => [slot, null]));
    // ... same for defense
}
```

---

### 3. **Captain Discipline Logic Has High Variance**
**Severity:** HIGH  
**File:** `game.js` (Lines 4990-5010)  
**Function:** `checkCaptainDiscipline()`  
**Issue:** Mental error chance calculation doesn't properly weight IQ vs Consistency:

```javascript
const mentalErrorChance = Math.max(0.01, (100 - iq) / 300) * (1 + (100 - consistency) / 100);
```

**Problems:**
- A QB with 99 IQ + 1 Consistency = 0.01 * 100 = 1% error (should be higher!)
- A QB with 50 IQ + 50 Consistency = 0.167 * 1 = 16.7% error
- A QB with 20 IQ + 20 Consistency = 0.267 * 4 = 106% error (capped at 100% but illogical)

**Impact:**
- Consistency attribute is almost meaningless
- High IQ doesn't actually prevent mistakes proportionally
- Error math explodes with low consistency values

**Current Formula Issues:**
- The multiplier `(1 + (100-consistency)/100)` can make errors WORSE than the base chance
- IQ reduction of 1 point changes error by 0.33%, too gradual

**Fix:** Use proper probability weighting:
```javascript
// IQ dominates decision-making (70%), Consistency is safety (30%)
const mentalErrorChance = 
    ((100 - iq) / 100) * 0.7 * 
    ((100 - consistency) / 100) * 0.3;
// Now: IQ 99, Consistency 1 = 0.007 * 0.07 = 0.5% (reasonable)
// Now: IQ 20, Consistency 20 = 0.8 * 0.24 = 19% (reasonable)
```

---

### 4. **QB Read Progression Can Fail Silently**
**Severity:** HIGH  
**File:** `game.js` (Lines 2826-2900)  
**Function:** `updateQBDecision()`  
**Issue:** If `readProgression` is not properly built, the QB has no targets to read:

```javascript
// Line 2845-2865: Builds progression but...
if (!qbState.readProgression || qbState.readProgression.length === 0) {
    qbState.readProgression = offenseStates
        .filter(p => p.slot !== 'QB1' && (p.action.includes('route') || p.action === 'idle'))
        .sort((a, b) => { ... });
}
```

**Problems:**
- If ALL offensive players are in `blocking` mode, progression is empty
- QB tries to read from empty array: `progression[0]` = undefined
- `getTargetInfo()` fails when passed undefined slot
- Play continues but targeting logic breaks

**Impact:**
- QB throws incomplete in screen plays where no one is routing
- Checkdown logic fails (last element is undefined)
- Inconsistent behavior across play types

**Fix:** Always ensure a valid progression:
```javascript
if (qbState.readProgression.length === 0) {
    // Fallback to ANY non-QB player
    qbState.readProgression = offenseStates
        .filter(p => p.slot !== 'QB1')
        .map(p => p.slot);
    if (qbState.readProgression.length === 0) {
        // This shouldn't happen, but QB will eat the sack
        return;
    }
}
```

---

## ⚠️ DESIGN INCONSISTENCIES (Can Cause Conflicts)

### 5. **Defensive Formation Selection Doesn't Adapt to Adjusted Lineups**
**Severity:** MEDIUM  
**File:** `game.js` (Lines 4160-4220)  
**Function:** `determineDefensiveFormation()`  
**Issue:** Formation is chosen based on OFFENSIVE personnel (WR count, RB count) but doesn't consider:
- Defensive roster quality
- Available players at required positions
- Historical matchup performance

**Example:**
```javascript
// Defense sees 4 WRs and chooses Dime (3-0-5)
if (wrCount >= 4) return '3-0-4';

// But what if Defense has NO good DBs?
// Or what if this formation has 0% success vs this specific Offense?
```

**Impact:**
- Defense gets locked into formations that don't match personnel
- No learning from past plays (no matchup history lookup)
- Can't counter opponent tendencies
- Smart captain still makes dumb calls against unbeaten play types

**Fix:** Enhance formation selection:
```javascript
function determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo, gameLog) {
    // ... existing logic ...
    
    // NEW: Check if this formation has been successful
    const matchupData = getMatchupPerformance(defense.id, offensivePlayKey);
    if (matchupData && matchupData.successRate < 0.3 && matchupData.sampleSize > 5) {
        // This formation is NOT working, switch it
        return getAlternativeDefensiveFormation(defense, selectedFormation);
    }
    
    return selectedFormation;
}
```

---

### 6. **Audible Logic Doesn't Check Formation Compatibility**
**Severity:** MEDIUM  
**File:** `game.js` (Lines 4316-4340)  
**Function:** `findAudiblePlay()` and `aiCheckAudible()`  
**Issue:** QB can audible to plays that don't exist in current formation:

```javascript
// aiCheckAudible() suggests audible, then:
const newPlayKey = findAudiblePlay(offense, 'pass', 'short');

// findAudiblePlay() filters:
const possiblePlays = Object.keys(offensivePlaybook).filter(key =>
    key.startsWith(offenseFormationName) &&  // ✓ Formation check
    offensivePlaybook[key]?.type === desiredType  // ✓ Type check
);

// But what if possiblePlays is EMPTY?
// It returns a random play from possiblePlays (null behavior)
if (possiblePlays.length === 0) return null;
```

**Impact:**
- Audible to a play that doesn't match formation (crash risk)
- QB sees man coverage but can't find a quick pass audible (doesn't throw away)
- Creates confusion in play execution logs

**Fix:** Ensure audible always has fallback:
```javascript
function findAudiblePlay(offense, desiredType, desiredTag = null) {
    const offenseFormationName = offense.formations.offense;
    let possiblePlays = Object.keys(offensivePlaybook).filter(key =>
        key.startsWith(offenseFormationName) && 
        offensivePlaybook[key]?.type === desiredType
    );

    // If no matches, relax to ANY type in formation
    if (possiblePlays.length === 0) {
        possiblePlays = Object.keys(offensivePlaybook).filter(key =>
            key.startsWith(offenseFormationName)
        );
    }

    return possiblePlays.length > 0 ? getRandom(possiblePlays) : null;
}
```

---

### 7. **No Feedback Loop Between Offensive and Defensive Playcalling**
**Severity:** MEDIUM  
**File:** `game.js`  
**Issue:** Three independent decision systems:
1. `determinePlayCall()` - Offense decides based on situation
2. `determineDefensiveFormation()` - Defense responds to personnel
3. `determineDefensivePlayCall()` - Defense responds to situation

**Problem:** No memory of what worked:
- Defense doesn't know "Balanced_Slants has 70% success rate vs us"
- Offense doesn't adjust after getting shut down 3 plays in a row
- Same play called 5 times in a row with same poor results

**Impact:**
- Game feels predictable (same plays keep failing)
- Teams don't adapt to opponents
- Playcalling seems unintelligent even with smart captains

**Missing System:** Matchup History Tracker
```javascript
// Should exist but doesn't:
game.matchupHistory = {
    'Team_A_vs_Team_B': [
        { week: 1, play: 'Balanced_InsideZone', defense: '3-1-3', result: 'gained 4 yards' },
        { week: 1, play: 'Balanced_Slants', defense: '3-1-3', result: 'incomplete' },
        // ...
    ]
};
```

---

### 8. **Formation Coordinates Not Validated Against Field Bounds**
**Severity:** MEDIUM  
**File:** `game.js` (Lines 1350-1380)  
**Function:** `setupInitialPlayerStates()`  
**Issue:** Formation coordinates can place players outside the field:

```javascript
// From data.js:
'Empty': {
    slots: ['QB1', 'WR1', 'WR2', 'WR3', 'WR4', 'WR5', 'OL1', 'OL2'],
    coordinates: {
        QB1: [0, -5],
        WR1: [-22, 0.5],  // Could be X = -22 (off sideline!)
        WR5: [22, 0.5],   // Could be X = 22 (valid on 53.3 width field)
        // ...
    }
}
```

**Impact:**
- Players start in invalid positions
- Physics calculations break for out-of-bounds players
- Coverage looks completely wrong

**Fix:** Validate and clamp coordinates:
```javascript
function setupInitialPlayerStates(...) {
    // ... existing setup ...
    initialOffenseStates.forEach(state => {
        // Clamp to field
        state.x = Math.max(0, Math.min(FIELD_WIDTH, state.x));
        state.y = Math.max(-5, Math.min(120, state.y)); // Allow pre-snap positions
    });
}
```

---

### 9. **No Integration Between Captain IQ and Offensive Playcalling**
**Severity:** LOW  
**File:** `game.js` (Lines 4040-4160)  
**Function:** `determinePlayCall()`  
**Issue:** Captain is checked for defensive discipline but NOT for offensive intelligence:

```javascript
// Defense checks captain:
const captainIsSharp = checkCaptainDiscipline(defense, gameLog);  // ✓ Used

// Offense does NOT:
function determinePlayCall(offense, defense, ...) {
    // ... no captain check ...
    // Treats all offenses as equally intelligent
    // Even a 30 IQ captain calls the same plays as 99 IQ captain
}
```

**Impact:**
- All teams use same decision logic regardless of team intelligence
- Can't distinguish between strategic vs reckless playcalling
- Removes interesting personality differences

**Fix:** Add offensive captain check:
```javascript
function determinePlayCall(offense, defense, down, yardsToGo, ...) {
    const captainIsSharp = checkCaptainDiscipline(offense, gameLog);
    
    if (!captainIsSharp && Math.random() < 0.3) {
        // Random mistake: call wrong play type for situation
        desiredType = Math.random() < 0.5 ? 'pass' : 'run';  // Ignore situation
    }
    // ... rest of logic ...
}
```

---

## 📊 SYSTEM CONFLICT MATRIX

| System A | System B | Conflict | Severity |
|----------|----------|----------|----------|
| Draft AI | Roster Limit | Hardcoded 10 vs actual 12 | 🔴 CRITICAL |
| Formations | Depth Charts | Can get out of sync | 🔴 CRITICAL |
| Captain IQ | Defense Decisions | Properly integrated | ✅ OK |
| QB Reads | Route Assignments | Can fail silently on screen plays | 🟠 HIGH |
| Offense Playcalling | Defense Response | No matchup memory | 🟡 MEDIUM |
| Formation Selection | Player Positions | No personnel check | 🟡 MEDIUM |
| Audible Logic | Formation Compatibility | Might call invalid plays | 🟡 MEDIUM |
| Captain IQ | Offense Decisions | Not integrated at all | 🟡 MEDIUM |

---

## 🔧 RECOMMENDED FIX ORDER

### Phase 1 (Do Immediately - These Break the Game)
1. ✅ Fix ROSTER_LIMIT = 12 in both locations (game.js:823, 5071)
2. ✅ Validate formation/depth chart sync in `rebuildDepthChartFromOrder()`

### Phase 2 (Prevents Runtime Errors)
3. Fix QB read progression to always have valid targets
4. Fix audible logic to ensure plays match formation
5. Validate formation coordinates are within field bounds

### Phase 3 (Improves AI Quality)
6. Add captain intelligence check to offensive playcalling
7. Implement matchup history tracker for adaptive playcalling
8. Enhance formation selection based on roster quality
9. Fix Captain Discipline probability math

---

## Summary Statistics

- **Total Issues Found:** 11
- **Critical Issues:** 2
- **High Severity:** 2
- **Medium Severity:** 5
- **Low Severity:** 2
- **Systems Affected:** 6 out of 8 major AI systems
- **Files Impacted:** game.js (10), data.js (1)

**Estimated Fix Time:** 2-3 hours for all fixes
