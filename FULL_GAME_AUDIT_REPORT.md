# FULL GAME AUDIT REPORT
**Date:** January 29, 2026  
**Status:** Comprehensive Code Review Complete  
**Total Issues Found:** 12 (3 Critical, 5 High, 4 Medium)

---

## 📊 EXECUTIVE SUMMARY

This audit examined all core game systems including:
- ✅ Captain discipline probability formula
- ✅ Formation coordinate validation
- ✅ Roster limit consistency
- ✅ QB read progression safety
- ✅ Audible logic fallbacks
- ✅ Depth chart sync mechanisms
- ✅ Physics calculations
- ✅ Player state management

**Good News:** Most Phase 1 fixes have been properly implemented.  
**Concerns:** Several edge cases and potential runtime issues identified.

---

## 🚨 CRITICAL ISSUES

### 1. **Formation/Depth Chart Desync Risk**
**File:** [game.js](game.js#L179-L280)  
**Functions:** `rebuildDepthChartFromOrder()`, `resolveDepthForPlay()`  
**Severity:** CRITICAL  
**Status:** Unresolved

#### Problem
If a formation definition changes (e.g., adding a new slot) but depth charts aren't updated, the system can create empty slot assignments that propagate through plays.

**Scenario:**
```javascript
// If Balanced formation adds a 9th player but depth chart only has 8:
offenseFormations['Balanced'].slots = ['QB1', 'RB1', 'WR1', 'WR2', 'TE1', 'OL1', 'OL2', 'OL3', 'OL4'];
// depthChart.offense still only maps 8 slots
// The 9th slot (OL4) gets assigned null player
```

**Impact:**
- `setupInitialPlayerStates()` tries to spawn a player for null playerId
- Physics updates fail silently for null players
- Statistics tracking breaks for the play
- Game continues but data is corrupted

**Recommendation:**
Add validation in `rebuildDepthChartFromOrder()` at line 255:
```javascript
// After line 255, add:
const actualSlots = offSlots.length;
const expectedSlots = team.depthChart.offense ? Object.keys(team.depthChart.offense).length : 0;
if (actualSlots !== expectedSlots) {
    console.warn(`⚠️ Formation slot mismatch for ${team.name}: formation has ${actualSlots} slots, depth chart has ${expectedSlots}`);
    // Reset depth chart to match formation
    team.depthChart.offense = Object.fromEntries(offSlots.map(slot => [slot, null]));
}
```

---

### 2. **QB Read Progression Can Be Empty After Initial Setup**
**File:** [game.js](game.js#L2860-2890)  
**Function:** `updateQBDecision()`  
**Severity:** CRITICAL  
**Status:** Partially Fixed

#### Problem
The safety check at line 2888 prevents crashes, but the root issue isn't addressed: `readProgression` can become empty if all receivers are blocked or injured.

```javascript
// Lines 2863-2878: Build progression filters out players with certain statuses
qbState.readProgression = offenseStates
    .filter(p => p.slot !== 'QB1' && (p.action.includes('route') || p.action === 'idle'))
    // ^ This filter can remove ALL players if no one is running a route or idle
```

**Impact:**
- QB gets stuck with empty progression for multiple ticks
- Returns early instead of making a decision
- No sack is applied (line 2891 just returns)
- Play becomes inconsistent (QB should scramble or eat sack)

**Recommendation:**
Force progression to include at least RBs as safety valve:
```javascript
// After line 2878, before the safety check:
if (!qbState.readProgression || qbState.readProgression.length === 0) {
    // Fallback: include ANY non-QB player as emergency receiver
    qbState.readProgression = offenseStates
        .filter(p => p.slot !== 'QB1')
        .map(p => p.slot);
    
    if (qbState.readProgression.length === 0) {
        // Truly no receivers - apply sack and return
        if (gameLog) gameLog.push(`${qbState.name} is completely alone and takes a sack!`);
        qbState.action = 'sacked';
        return;
    }
}
```

---

### 3. **Player Roster Can Contain Deleted/Null Player IDs**
**File:** [game.js](game.js#L179-L325)  
**Function:** `rebuildDepthChartFromOrder()`  
**Severity:** CRITICAL  
**Status:** Partially Fixed

#### Problem
Line 323 filters out undefined players, but the roster array itself can still contain deleted player references if a player is removed from `playerMap` without removing their ID from the roster.

```javascript
// This can happen if:
team.roster = ['p1', 'p2', 'p3'];  // p2 is deleted from playerMap
const rosterObjs = getRosterObjects(team);  // Returns [p1, p3] with gap
// Now resolveDepthForPlay() tries to use p2 in playState and fails
```

**Impact:**
- Depth chart has null values that persist
- Formation setup skips positions without players
- AI teams can play with incomplete rosters
- Stats calculations skip null entries silently

**Recommendation:**
Add roster cleanup in `rebuildDepthChartFromOrder()` at line 195:
```javascript
// After line 195, add cleanup:
// Remove any player IDs from roster that no longer exist in playerMap
team.roster = team.roster.filter(id => {
    const p = getPlayer(id);
    if (!p) {
        console.warn(`⚠️ Removing non-existent player ${id} from ${team.name} roster`);
        return false;
    }
    return true;
});
```

---

## 🔴 HIGH SEVERITY ISSUES

### 4. **Audible Logic Doesn't Handle Edge Formation Cases**
**File:** [game.js](game.js#L4356-4380)  
**Function:** `findAudiblePlay()`  
**Severity:** HIGH  
**Status:** Partially Fixed

#### Problem
The fallback at line 4364 returns null if formation has no plays at all, but some edge formations might have plays defined only for specific tags. The function then returns `null` without a secondary fallback.

```javascript
if (possiblePlays.length === 0) {
    possiblePlays = Object.keys(offensivePlaybook).filter(key =>
        key.startsWith(offenseFormationName)
    );
    if (possiblePlays.length === 0) return null;  // <-- Can cause caller to fail
}
```

**Impact:**
- `aiCheckAudible()` receives null at line 4392
- The check `if (audibleTo)` prevents crash, but the QB doesn't audible when they should
- Offense can't adapt to defensive formations

**Recommendation:**
Add emergency fallback to a default formation's plays:
```javascript
if (possiblePlays.length === 0) {
    // Last resort: use Balanced formation plays
    possiblePlays = Object.keys(offensivePlaybook).filter(key =>
        key.startsWith('Balanced')
    );
}
if (possiblePlays.length === 0) {
    return null; // Truly no valid plays exist (shouldn't happen)
}
```

---

### 5. **Depth Chart AI Assignment Doesn't Consider Injuries**
**File:** [game.js](game.js#L5350-5385)  
**Function:** `aiSetDepthChart()`  
**Severity:** HIGH  
**Status:** Unresolved

#### Problem
The function fills slots with any available player but doesn't check injury status before assigning. A player with 2 weeks of suspension can be placed as a starter.

```javascript
// The position matching works, but injury check is too loose:
if (!p.status || p.status.duration === 0) {
    // This returns true if status is undefined OR duration is 0
    // But if a player just got injured last tick, duration might be > 0
    return p;  // Still returns them as healthy
}
```

**Impact:**
- AI teams start injured players
- Depth chart doesn't reflect actual team health
- Stats become misleading (injured players still recorded)

**Recommendation:**
Add explicit injury check:
```javascript
if (!p.status || (p.status.duration !== undefined && p.status.duration === 0)) {
    // Confirm player is truly healthy
    if (p.status && p.status.type === 'injured') return false;  // Definitely injured
    return true;
}
```

---

### 6. **Physics Updates Don't Handle NaN Velocity**
**File:** [game/physics.js](js/game/physics.js#L50-L100)  
**Function:** `updatePlayerPosition()`  
**Severity:** HIGH  
**Status:** Unresolved

#### Problem
If a player's target coordinates are invalid (NaN or infinity), the velocity calculation produces NaN values that propagate through the simulation.

```javascript
const dx = (pState.targetX || pState.x) - pState.x;  // Could be NaN - NaN = NaN
const dy = (pState.targetY || pState.y) - pState.y;
const distToTarget = Math.sqrt(dx * dx + dy * dy);   // sqrt(NaN) = NaN

// Later:
targetVx = dirX * maxSpeed * arrivalFactor;  // NaN * number = NaN
pState.vx += (targetVx - pState.vx) * acceleration * timeDelta;  // Propagates NaN
pState.x += pState.vx * timeDelta;  // Now position becomes NaN
```

**Impact:**
- Players get stuck with NaN positions
- Distance calculations return Infinity
- Collisions/tackles can't be detected
- Visual rendering shows errors

**Recommendation:**
Add NaN sanitization:
```javascript
// After calculating distToTarget, add:
if (!isFinite(distToTarget)) {
    console.warn(`⚠️ Invalid distance for player ${pState.id}: targetX=${pState.targetX}, targetY=${pState.targetY}`);
    pState.targetX = pState.x;  // Snap to current position
    pState.targetY = pState.y;
    return;
}

// Before updating position, add:
if (!isFinite(pState.vx) || !isFinite(pState.vy)) {
    pState.vx = 0;
    pState.vy = 0;
}
```

---

### 7. **Fatigue Modifier Not Always Initialized**
**File:** [game.js](game.js#L1000-1100)  
**Function:** `setupInitialPlayerStates()` and physics  
**Severity:** HIGH  
**Status:** Unresolved

#### Problem
Player state fatigue modifiers might not be set during play setup, causing different speeds in first play vs. subsequent plays.

```javascript
// game.js doesn't explicitly set fatigueMod for each player
// physics.js assumes it exists:
const fatigueMod = pState.fatigueModifier || 1.0;  // Default hides the issue
```

**Impact:**
- Players run at full speed in first play (fatigueModifier = 1.0)
- After one play, fatigue builds and fatigueModifier becomes 0.8+
- Speed inconsistency between plays
- Stats become unpredictable

**Recommendation:**
Initialize fatigue in `setupInitialPlayerStates()`:
```javascript
// Add after line 1455 in setupInitialPlayerStates():
playState.activePlayers.forEach(pState => {
    if (typeof pState.fatigueModifier === 'undefined') {
        const player = getPlayer(pState.id);
        const stamina = player?.attributes?.physical?.stamina || 50;
        pState.fatigueModifier = 1.0 - ((100 - stamina) / 500);  // 0.8 - 1.0 based on stamina
    }
});
```

---

## 🟡 MEDIUM SEVERITY ISSUES

### 8. **Captain Discipline Formula Still Has Mathematical Edge Case**
**File:** [game.js](game.js#L5056-5062)  
**Function:** `checkCaptainDiscipline()`  
**Severity:** MEDIUM  
**Status:** Partially Fixed

#### Problem
The fixed formula is mathematically correct but edge cases exist:
- A captain with 0 IQ and 0 Consistency = 1.0 * 0.7 + 1.0 * 0.3 = 1.0 (100% error) - CORRECT
- A captain with 100 IQ and 100 Consistency = 0.0 * 0.7 + 0.0 * 0.3 = 0.0 (0% error) - CORRECT
- BUT: The mentalErrorChanceClamped clamps to 0.001-0.95, so perfect players can't have true 0% error

```javascript
const mentalErrorChanceClamped = Math.max(0.001, Math.min(0.95, mentalErrorChance));
// A QB with 100 IQ, 100 Consistency can still fail with 0.1% chance
// This is actually fine for game balance, but unintuitive
```

**Impact:**
- Elite QBs still throw interceptions (0.1% of passes)
- Over a 200-play season, an elite QB will throw ~0.2 picks due to this floor
- Statistically insignificant but inconsistent with design intent

**Recommendation:**
Decide on intended behavior:
```javascript
// OPTION A: Allow perfect QBs to have 0% error chance
const mentalErrorChanceClamped = Math.max(0, Math.min(0.95, mentalErrorChance));

// OPTION B: Keep current behavior and document why
// This is acceptable for game balance - no player is ever 100% perfect
```

---

### 9. **Resolve Depth Fallback Doesn't Check Position Compatibility**
**File:** [game.js](game.js#L1340-1380)  
**Function:** `resolveDepthForPlay()`  
**Severity:** MEDIUM  
**Status:** Unresolved

#### Problem
The emergency fallback (line 1360) assigns ANY healthy player to a position without checking if they're suitable. A DB might be assigned as an OL.

```javascript
// Line 1360-1365:
if (!playerId) {
    const emergency = rosterObjs.find(p =>
        p &&
        (!p.status || p.status.duration === 0) &&
        !Object.values(resolved[side]).includes(p.id)
    );
    if (emergency) playerId = emergency.id;  // Could be wrong position!
}
```

**Impact:**
- Lineup mismatches (WR playing OL, DB playing QB)
- Speed and blocking stats won't match position needs
- Coverage calculations fail (DB has wrong speed)
- Offensive line has receivers (weak blocking)

**Recommendation:**
Add position matching to emergency fallback:
```javascript
// Replace line 1360-1365 with:
if (!playerId) {
    // Prefer someone at similar position even if not exact match
    const basePos = basePos.replace(/\d/g, '');
    const emergency = rosterObjs.find(p =>
        p &&
        (!p.status || p.status.duration === 0) &&
        !Object.values(resolved[side]).includes(p.id) &&
        (p.favoriteOffensivePosition === basePos || p.favoriteDefensivePosition === basePos)
    );
    
    if (!emergency && side === 'offense' && basePos.startsWith('OL')) {
        // If no OL available, any heavy player (RB/TE with high strength)
        playId = rosterObjs
            .filter(p => !Object.values(resolved[side]).includes(p.id) && p && (!p.status || p.status.duration === 0))
            .sort((a, b) => (b.attributes?.physical?.strength || 50) - (a.attributes?.physical?.strength || 50))[0]?.id;
    } else {
        playerId = emergency?.id;
    }
}
```

---

### 10. **Game Loop Timer Doesn't Account for Dropped Frames**
**File:** [game.js](game.js#L4620-4700)  
**Function:** `simulateLivePlayStep()`  
**Severity:** MEDIUM  
**Status:** Unresolved

#### Problem
The fast simulation increments `game.drivesThisHalf` by a fixed 0.2 per call, but if the browser drops frames or computation takes longer, this creates timing issues.

```javascript
// Line 4660-4670:
while (game.drivesThisHalf < TOTAL_DRIVES_PER_HALF * 2) {
    simulateLivePlayStep(game);
    game.drivesThisHalf += 0.2;  // Fixed increment regardless of actual time
}
```

**Impact:**
- Games might end prematurely if loop runs fewer iterations
- Games might not end if loop runs more iterations
- Score outcomes can be inconsistent
- Halftime doesn't always occur at proper game time

**Recommendation:**
Use actual play counter instead of fractional increment:
```javascript
// Replace line 4660 with:
let playsThisHalf = 0;
const PLAYS_PER_HALF = getRandomInt(15, 25);  // Typical play count

while (playsThisHalf < PLAYS_PER_HALF) {
    simulateLivePlayStep(game);
    playsThisHalf++;  // Count actual plays
}
```

---

### 11. **Relationship Level Data Can Be Stale**
**File:** [data.js](js/data.js#L1-20)  
**Severity:** MEDIUM  
**Status:** Unresolved

#### Problem
Relationship levels are imported but the scoutAccuracy values might not align with probability calculations elsewhere.

```javascript
// data.js:
ACQUAINTANCE: { level: 1, callChance: 0.30, scoutAccuracy: 0.4, ... }

// But in ui.js or game.js, different thresholds might be used:
// if (relationship > 0.3) => Don't match data.js
```

**Impact:**
- Scouting reports show different accuracy than actual
- Player selection strategy becomes unreliable
- UI promises (e.g., "40% accuracy") don't match gameplay

**Recommendation:**
Add validation when loading relationships:
```javascript
// In game initialization:
const validateRelationshipData = () => {
    for (const [key, rel] of Object.entries(relationshipLevels)) {
        if (rel.scoutAccuracy < 0 || rel.scoutAccuracy > 1) {
            console.error(`⚠️ Invalid scoutAccuracy for ${key}: ${rel.scoutAccuracy}`);
        }
        if (rel.callChance < 0 || rel.callChance > 1) {
            console.error(`⚠️ Invalid callChance for ${key}: ${rel.callChance}`);
        }
    }
};
validateRelationshipData();
```

---

### 12. **Offense Formation Might Not Have Pass Plays**
**File:** [game.js](game.js#L4425-4450)  
**Function:** `aiCheckAudible()`  
**Severity:** MEDIUM  
**Status:** Partially Fixed

#### Problem
The audible logic tries to find a pass play, but if the current formation has NO pass plays defined, it still attempts the audible with null result.

```javascript
// Line 4425:
const audibleTo = findAudiblePlay(offense, 'pass', 'short');
if (audibleTo) {  // This check prevents crash, but audible silently fails
    newPlayKey = audibleTo;
    didAudible = true;
} else {
    // QB wanted to pass but formation only has run plays
    // Game log doesn't explain why audible failed
}
```

**Impact:**
- Audibles appear to fail without explanation
- AI QB can't adapt to perfect defense
- Stats show missed audible opportunities
- Gameplay feels broken to player

**Recommendation:**
Add logging and fallback:
```javascript
// Replace line 4425-4432 with:
const audibleTo = findAudiblePlay(offense, 'pass', 'short');
if (audibleTo) {
    newPlayKey = audibleTo;
    didAudible = true;
    if (gameLog) gameLog.push(`[Audible]: 🧠 ${qb.name} (IQ:${qbIQ}) audibles to pass!`);
} else {
    // Formation has no pass plays - try any play as fallback
    const fallbackPlay = findAudiblePlay(offense, 'any');
    if (fallbackPlay) {
        newPlayKey = fallbackPlay;
        didAudible = true;
        if (gameLog) gameLog.push(`[Audible]: ${qb.name} adjusts play (no pass option available)`);
    }
}
```

---

## ✅ VERIFIED AS FIXED

### Fixed in Phase 1:
- ✅ **Captain Discipline Probability Formula** - IQ/Consistency properly weighted (line 5056-5062)
- ✅ **Formation Coordinate Validation** - Implemented validateFormationCoordinate() (line 99-118)
- ✅ **ROSTER_LIMIT Consistency** - All instances updated to 12 (lines 791, 856, 5127, 5685)
- ✅ **QB Read Progression Safety** - Added fallback check (line 2888-2891)
- ✅ **Audible Logic Fallback** - Added formation-wide play search (line 4364-4369)
- ✅ **Roster Cleanup** - Filter removes undefined players (line 323)

---

## 📋 SUMMARY TABLE

| Issue | Severity | Status | File | Line(s) | Fix Time |
|-------|----------|--------|------|---------|----------|
| Formation/Depth Desync | 🚨 Critical | Open | game.js | 179-280 | ~30min |
| QB Read Empty Fallback | 🚨 Critical | Partial | game.js | 2860-2890 | ~20min |
| Roster Null IDs | 🚨 Critical | Partial | game.js | 179-325 | ~15min |
| Audible Edge Cases | 🔴 High | Partial | game.js | 4356-4380 | ~15min |
| Depth Chart Injuries | 🔴 High | Open | game.js | 5350-5385 | ~20min |
| Physics NaN Velocity | 🔴 High | Open | physics.js | 50-100 | ~25min |
| Fatigue Init | 🔴 High | Open | game.js | 1000-1100 | ~20min |
| Captain Math Edge | 🟡 Medium | Partial | game.js | 5056-5062 | ~10min |
| Position Compatibility | 🟡 Medium | Open | game.js | 1340-1380 | ~25min |
| Game Loop Timer | 🟡 Medium | Open | game.js | 4620-4700 | ~15min |
| Relationship Data | 🟡 Medium | Open | data.js | 1-20 | ~10min |
| Pass Play Audible | 🟡 Medium | Partial | game.js | 4425-4450 | ~10min |

---

## 🎯 PRIORITY FIXES (Recommended Order)

### Phase 2 (CRITICAL - Do First):
1. **Formation/Depth Desync** - Prevent data corruption
2. **QB Read Empty** - Prevent play logic breaks  
3. **Physics NaN** - Prevent simulation hangs

### Phase 3 (HIGH - Do Second):
4. **Fatigue Initialization** - Ensure consistent speed
5. **Depth Chart Injuries** - Prevent injured starters
6. **Position Compatibility** - Prevent misaligned lineups

### Phase 4 (MEDIUM - Do Third):
7. **Game Loop Timer** - Ensure consistent game lengths
8. **Audible Edge Cases** - Improve QB adaptation
9. **All Medium Issues** - Polish and edge case handling

---

## 🧪 TESTING RECOMMENDATIONS

```javascript
// Test Formation Desync
const testFormationDesync = () => {
    const team = game.teams[0];
    const formationSlots = offenseFormations[team.formations.offense].slots.length;
    const chartSlots = Object.keys(team.depthChart.offense).length;
    console.assert(formationSlots === chartSlots, 
        `Desync: formation ${formationSlots} vs chart ${chartSlots}`);
};

// Test QB Progression
const testQBProgression = () => {
    // Simulate all players blocking, QB should still have fallback
    const testPlay = {
        readProgression: ['WR1'],  // Only one option
        // All WRs get blocked
        // QB should still be able to throw to RB
    };
};

// Test Physics NaN
const testPhysicsNaN = () => {
    const player = { x: NaN, y: 0, targetX: undefined, targetY: undefined };
    updatePlayerPosition(player, 0.05);
    console.assert(isFinite(player.x) && isFinite(player.y),
        `Physics produced NaN: ${player.x}, ${player.y}`);
};
```

---

## 📝 NOTES

- **Code Quality:** Generally good with proper error handling in most areas
- **Architecture:** Modular design works well; separation of concerns is strong
- **Documentation:** Good inline comments explaining complex logic
- **Performance:** Fast simulator runs efficiently; physics are CPU-friendly

---

**Report Generated:** January 29, 2026  
**Reviewed By:** Game Audit System  
**Next Review:** After Phase 2 fixes implementation
