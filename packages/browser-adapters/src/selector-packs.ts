import amazonJson from "../packs/amazon.json" with { type: "json" };
import bestBuyJson from "../packs/bestbuy.json" with { type: "json" };
import observeOnlyJson from "../packs/retailers.json" with { type: "json" };
import targetJson from "../packs/target.json" with { type: "json" };
import walmartJson from "../packs/walmart.json" with { type: "json" };
import type { SupportedRetailerId } from "../../contracts/src/index.js";

export const SELECTOR_PACK_FIELDS = [
  "addControl", "price", "seller", "availability", "fulfillmentRoot", "fulfillmentTile",
  "quantity", "primaryScope", "merchandisingScope", "secondaryActionScope", "structuredData", "offerInput"
] as const;
export type SelectorPackField = (typeof SELECTOR_PACK_FIELDS)[number];

export interface FrozenSelectorPack {
  readonly packVersion: string;
  readonly retailerId: SupportedRetailerId;
  readonly fields: Readonly<Record<SelectorPackField, readonly string[]>>;
}

type JsonField = { selectors?: string[] };
type AddPackJson = {
  packVersion: string;
  retailerId: string;
  fields: Partial<Record<SelectorPackField, JsonField>>;
};

function selectorList(value: unknown): readonly string[] {
  return Object.freeze(Array.isArray(value) ? value.map(String) : []);
}

function freezePack(value: AddPackJson): FrozenSelectorPack {
  const fields = Object.fromEntries(SELECTOR_PACK_FIELDS.map((field) => [
    field,
    selectorList(value.fields[field]?.selectors)
  ])) as Record<SelectorPackField, readonly string[]>;
  return Object.freeze({
    packVersion: value.packVersion,
    retailerId: value.retailerId as SupportedRetailerId,
    fields: Object.freeze(fields)
  });
}

export const ADD_SELECTOR_PACKS = Object.freeze({
  target: freezePack(targetJson),
  walmart: freezePack(walmartJson),
  amazon: freezePack(amazonJson),
  bestbuy: freezePack(bestBuyJson)
});

type ObserveOnlyId = Exclude<SupportedRetailerId, keyof typeof ADD_SELECTOR_PACKS>;
const observeOnlyRetailers = Object.fromEntries(Object.entries(observeOnlyJson.retailers).map(([retailerId, fields]) => [
  retailerId,
  Object.freeze({
    addControl: selectorList(fields.addControl),
    price: selectorList(fields.price),
    seller: selectorList(fields.seller)
  })
])) as Record<ObserveOnlyId, Readonly<Record<"addControl" | "price" | "seller", readonly string[]>>>;

export const OBSERVE_ONLY_SELECTOR_PACK = Object.freeze({
  packVersion: observeOnlyJson.packVersion,
  retailers: Object.freeze(observeOnlyRetailers)
});

const OBSERVE_ONLY_FULFILLMENT_TILES = Object.freeze([
  "[aria-selected='true']", "[data-selected='true']", "input:checked"
]);

export const SELECTOR_PACK_VERSIONS: Readonly<Record<SupportedRetailerId, string>> = Object.freeze({
  target: ADD_SELECTOR_PACKS.target.packVersion,
  walmart: ADD_SELECTOR_PACKS.walmart.packVersion,
  amazon: ADD_SELECTOR_PACKS.amazon.packVersion,
  bestbuy: ADD_SELECTOR_PACKS.bestbuy.packVersion,
  disney: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  ravensburger: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  riot: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  booksamillion: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  fanatics: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  kohls: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  macys: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  pbandai: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  pokemoncenter: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  asus: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  audioadvice: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  bananarepublic: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  bananarepublicfactory: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  athleta: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  americaneagle: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
  aninebing: OBSERVE_ONLY_SELECTOR_PACK.packVersion
});

export function selectorsFor(
  retailerId: SupportedRetailerId,
  field: SelectorPackField
): readonly string[] {
  if (retailerId in ADD_SELECTOR_PACKS) {
    return ADD_SELECTOR_PACKS[retailerId as keyof typeof ADD_SELECTOR_PACKS].fields[field];
  }
  if (field === "fulfillmentTile") return OBSERVE_ONLY_FULFILLMENT_TILES;
  if (field !== "addControl" && field !== "price" && field !== "seller") return Object.freeze([]);
  return OBSERVE_ONLY_SELECTOR_PACK.retailers[retailerId as ObserveOnlyId][field];
}
