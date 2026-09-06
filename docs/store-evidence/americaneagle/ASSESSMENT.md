# American Eagle assessment — September 6, 2026

Guest browsing and two one-size accessory Add tests succeeded in isolated
context `howl-americaneagle`. These were guarded, one-time clicks on the
observed storefront controls; a packaged Yoink runner and app integration
are still required.

| Product | Style/color ID | Size | Price | Cart result |
| --- | --- | --- | --- | --- |
| AE Off-Duty Snoopy Tote Bag | `0427_9775_410` | One Size | $34.95 | +1 from empty |
| AE Halloweenie Bag Charm | `0577_9778_900` | One Size | $17.95 | +1; tote unchanged |

The final cart had two independently counted items, both quantity one,
merchandise $52.90, shipping $7.95, and subtotal $60.85. Both items were removed
individually using their row's Remove control. At 09:08:37 UTC the header count
was zero, no `.cart-item` rows remained, and the page said “Your bag is empty.
Find something you love!” No checkout was submitted and no images were viewed.

The adjacent JSON files record capture URLs and times. HTML captures retain
actual product/cart markup with scripts and images removed; visibility is
stamped as `data-assessment-visible`. Product JSON preserves the selected
product's public structured offer separately.

Useful observed bindings:

- Product URLs may include the title/category path or use `/us/en/p/<ID>`.
  Cart product links use the short form. Structured Product `sku` is the
  style/color ID, and its offer supplies USD price and stock state.
- `[data-test-psp]` scopes the primary `button[data-test-btn="addToBag"]`.
  Recommendations have additional Add buttons outside that scope.
- `[data-test-dropdown-toggle][aria-label="Size"]` displays the selection;
  both accessories settled on One Size automatically after hydration.
  `[data-test-select-quantity]` displayed 1.
- `/us/en/cart` contains `.cart-item` rows, product links, size/color text,
  `[data-testid="quantity"]` with “Qty: 1”, and
  `[data-test-cart-item-price]`. The removal control is
  `button[data-test-btn="removeCommerceItem"]` within the exact row.
- `a.qa-tnav-bag-icon` opens the cart; its `[data-test-content]` contains the
  independent item count. The cart also displays “1 Item” or “2 Items”.

The dress `0395_9442_601` was inspected at $38.97 and size M could be selected.
Its URL and structured SKU did not expose a size-specific child ID. Start with
the proven one-size layout; size-dependent products need additional identity
and navigation support. Navigation repeatedly timed out while pages continued
loading successfully, so a timeout alone does not establish a roadblock.
