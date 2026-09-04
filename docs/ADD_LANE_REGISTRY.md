# Guarded add-lane registry

`packages/contracts/src/add-lanes.ts` is the source of truth for guarded add
lane identity, packaged versions, runner operations, capabilities, activation
confirmation, seller policy, and operator guidance. The API, local
qualification repository, PostgreSQL non-Target qualification writer, and
Chrome companion consume that registry. The four store-specific API and
message URLs remain compatibility aliases for one release; they dispatch to
the same parameterized paths.

Selector packs remain local build inputs. They are bundled into the companion
and are never obtained from a remote endpoint. Adding a lane must not add a
database table.

## Fifth-store dry run

The proof branch is `p7/pokemoncenter-add-dry-run` at
`8596b64a38d45432dffc010e35bd83877269ddce`. Its commit changes exactly the
eight paths below and passes the registry build plus promoted-corpus tests.
Pokémon Center is used
because its read-only adapter, selector pack entry, and optional host
permission already exist. Promoting it to guarded add therefore changes the
following eight files:

1. `packages/contracts/src/add-lanes.ts`
2. `apps/extension/src/pokemoncenter-action.ts`
3. `test/fixtures/capsules/pokemoncenter/first-party-shipping.json`
4. `test/fixtures/capsules/pokemoncenter/first-party-shipping.html.gz`
5. `test/fixtures/capsules/pokemoncenter/unavailable.json`
6. `test/fixtures/capsules/pokemoncenter/unavailable.html.gz`
7. `test/fixtures/capsules/pokemoncenter/third-party.json`
8. `test/fixtures/capsules/pokemoncenter/third-party.html.gz`

The registry-driven build discovers the runner and the packager includes only
registered runner files. Generated `apps/extension/add-lanes.js`,
`adapter-versions.js`, and `pokemoncenter-action.js` outputs are build
artifacts, not hand-edited onboarding surfaces. The dry-run branch does not
ship the lane; it demonstrates the integration budget and keeps live
activation closed.
