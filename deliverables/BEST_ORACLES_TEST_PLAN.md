# Best Oracles Test Plan - Tinder Frontend PR

## Scope
This plan validates the PR behaviors:
- Swipe left -> Reject
- Swipe right -> Like
- Swipe up -> Super like
- Bottom buttons (`✖`, `★`, `♥`) mapped to same actions
- Double-tap / double-click cycles profile photos
- Multi-photo data model via `data-photos` + `data-photo-idx`

## Environment
- App served from project root (frontend in browser)
- Optional backend running (`npm start`) for decision post and match polling
- Browser: Chrome/Edge latest

## Best Oracles (pass/fail signals)
1. **Deck state transition oracle**: Top card removed and card count decreases by 1 after a decision action.
2. **Action parity oracle**: A button click yields the same state transition as the corresponding swipe.
3. **Photo-cycle oracle**: Double interaction advances `data-photo-idx` and `img.src` while card count stays unchanged.
4. **Data contract oracle**: Rendered top card includes valid `data-photos` JSON array and numeric `data-photo-idx`.
5. **Threshold oracle**: Movement below swipe thresholds snaps back and does not remove card.
6. **No-crash oracle**: Actions when deck is empty do not throw errors.

## Test Cases

### BO-01 Swipe Left Reject
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Drag top card left beyond threshold and release.
- **Expected**:
  - Top card is removed from DOM.
  - Deck count decreases by 1.
  - Next card becomes top card.

### BO-02 Swipe Right Like
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Drag top card right beyond threshold and release.
- **Expected**:
  - Top card is removed from DOM.
  - Deck count decreases by 1.
  - Next card becomes top card.

### BO-03 Swipe Up Super Like
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Drag top card up beyond threshold and release.
- **Expected**:
  - Top card is removed from DOM.
  - Deck count decreases by 1.
  - Next card becomes top card.

### BO-04 Below-Threshold Drag Snapback
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Drag top card slightly (less than threshold), release.
- **Expected**:
  - Card returns to original position.
  - Deck count unchanged.
  - Same card remains on top.

### BO-05 Nope Button Parity
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Click `✖` button.
- **Expected**:
  - Same result as BO-01 (count -1, top card removed).

### BO-06 Like Button Parity
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Click `♥` button.
- **Expected**:
  - Same result as BO-02 (count -1, top card removed).

### BO-07 Super Like Button Parity
- **Precondition**: Deck rendered with at least 1 card.
- **Action**: Click `★` button.
- **Expected**:
  - Same result as BO-03 (count -1, top card removed).

### BO-08 Double-Click Photo Cycle
- **Precondition**: Top card exists with photo array length >= 2.
- **Action**: Double-click top card image.
- **Expected**:
  - `data-photo-idx` increments by 1 (mod photos length).
  - Top card `img.src` updates to next photo.
  - Deck count unchanged.

### BO-09 Single Click Does Not Cycle
- **Precondition**: Top card exists.
- **Action**: Single click on top image.
- **Expected**:
  - `data-photo-idx` unchanged.
  - `img.src` unchanged.

### BO-10 Photo Index Wraparound
- **Precondition**: Top card has N photos.
- **Action**: Perform N double-click cycles.
- **Expected**:
  - `data-photo-idx` returns to original value.
  - Card remains in deck.

### BO-11 Data Attributes Present
- **Precondition**: Deck rendered.
- **Action**: Inspect top card element.
- **Expected**:
  - `data-photos` exists and parses to non-empty array.
  - `data-photo-idx` exists and is a valid integer.

### BO-12 Empty Deck Safety
- **Precondition**: Remove all cards via repeated decisions.
- **Action**: Click `✖`, `★`, `♥` with no cards left.
- **Expected**:
  - No runtime error in console.
  - UI remains responsive.

## Quick Browser Console Checks
Use these snippets while app is open:

```js
// Current card count
document.querySelectorAll(".card").length
```

```js
// Top card data contract
const top = document.querySelector(".card:last-child");
({
  hasPhotos: !!top?.dataset.photos,
  parsedLen: JSON.parse(top?.dataset.photos || "[]").length,
  photoIdx: top?.dataset.photoIdx
});
```

```js
// Top card image
document.querySelector(".card:last-child img")?.src
```

## Acceptance Criteria
- All BO-01 to BO-12 pass.
- No uncaught errors during interaction.
- Button actions are behaviorally equivalent to swipes.
