## Best Oracles Review - Test Deliverable

I validated this PR using behavior-oriented oracles focused on state transitions and observable DOM effects.

### Oracle strategy
- **Decision actions (swipe/button)**: oracle is card stack transition (`.card` count decreases, top card changes).
- **Photo cycling**: oracle is `data-photo-idx` increment + `img.src` change without card removal.
- **Data model support**: oracle is presence/validity of `data-photos` and `data-photo-idx`.
- **Edge safety**: oracle is no uncaught runtime errors on empty deck and below-threshold drags.

### Coverage
- Swipe left/right/up behavior
- Button parity with swipe actions (`✖`, `★`, `♥`)
- Double-click / double-tap cycling
- Photo index wraparound
- Empty-deck safety

See:
- `deliverables/BEST_ORACLES_TEST_PLAN.md`
- `deliverables/BEST_ORACLES_TEST_REPORT_TEMPLATE.md`
