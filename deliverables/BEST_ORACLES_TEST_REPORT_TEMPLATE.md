# Best Oracles Test Report (Template)

## Submission Info
- Course: ____________________
- Student: ____________________
- Date: ____________________
- PR Under Test: ____________________
- Branch Under Test: ____________________
- Tester Environment: ____________________

## Execution Summary
- Total test cases: 12
- Passed: ___
- Failed: ___
- Blocked: ___

## Detailed Results

| ID | Test Name | Result (Pass/Fail/Blocked) | Evidence | Notes |
|---|---|---|---|---|
| BO-01 | Swipe Left Reject |  |  |  |
| BO-02 | Swipe Right Like |  |  |  |
| BO-03 | Swipe Up Super Like |  |  |  |
| BO-04 | Below-Threshold Drag Snapback |  |  |  |
| BO-05 | Nope Button Parity |  |  |  |
| BO-06 | Like Button Parity |  |  |  |
| BO-07 | Super Like Button Parity |  |  |  |
| BO-08 | Double-Click Photo Cycle |  |  |  |
| BO-09 | Single Click Does Not Cycle |  |  |  |
| BO-10 | Photo Index Wraparound |  |  |  |
| BO-11 | Data Attributes Present |  |  |  |
| BO-12 | Empty Deck Safety |  |  |  |

## Defects / Risks Found
1. ____________________
2. ____________________
3. ____________________

## Oracle Justification (What made results trustworthy)
- **Primary oracle**: deck state change (`.card` count and top-card replacement) for decision actions.
- **Secondary oracle**: `data-photo-idx` and `img.src` updates for photo-cycle behavior.
- **Safety oracle**: no uncaught console errors during empty-deck and edge interactions.

## Final Verdict
- [ ] Ready to merge
- [ ] Merge with minor fixes
- [ ] Do not merge (major issues)

Rationale: ____________________
