# Yoink product glossary

Use these labels in shopper, admin, Chrome companion, and help copy. They are
the names people should learn; database columns, API fields, route names,
audit reason codes, and maintainer-only protocol evidence retain their stable
machine names.

| Product concept | Use | Do not use in product copy |
| --- | --- | --- |
| A saved product and its buying limits | **Plan** | mission, purchase intent, purchase preferences |
| A merchant on shopper surfaces | **Store** | retailer |
| A store execution boundary in admin qualification | **Lane** | retailer lane |
| A source event shown to a shopper | **Call** | signal, opportunity |
| TrackaLacker, Discord, and approved API channels | **Sources** | integrations, connections |
| An admin-managed evaluation default | **Rule** | strategy |
| Account and product configuration | **Settings** | preferences |
| The paired browser extension | **Chrome companion** | device, executor |
| Reusable limits selected from Quick add | **Quick add setup** | profile, purchase default, saved setup |
| The built-in notification-only choice | **Notify-only setup** | system default, built-in default, notify-only default |

Within the Calls list only, **Signal**, **Drop**, and **Queue** are controlled type-tag labels. Use **Call** everywhere else in shopper-facing prose, headings, and actions.

## Handoff stages

Use the same five stage labels everywhere:

1. **Queued**
2. **Checking**
3. **Ready to check out**
4. **Needs you**
5. **Closed**

“Got it” and “Missed it” are closeout choices, not additional stages.

## Writing rules

- Use sentence case.
- Name the next action with a verb.
- Keep stable API confirmation phrases byte-identical; they are protocol
  values, not product copy.
- Use technical machine names only inside Maintainer evidence, diagnostics, or
  an explicitly expanded technical-details region.
