import type { TFunction } from "i18next";
import type { Schemas } from "@darna/api-client";
import type { Option } from "../components/Choice";

export const PROPERTY_TYPES: Schemas["PropertyType"][] = ["apartment", "duplex", "penthouse", "studio", "villa", "townhouse", "twin_house"];
export const FINISHINGS: Schemas["Finishing"][] = ["core_shell", "semi_finished", "fully_finished", "furnished"];
export const DELIVERY: Schemas["DeliveryStatus"][] = ["ready", "under_construction"];
export const ORIENTATIONS: Schemas["Orientation"][] = ["north", "south", "east", "west", "north_east", "north_west", "south_east", "south_west"];
export const PAYMENT_MODES: Schemas["PaymentMode"][] = ["cash", "installments"];
/** Types identified by unit number (apartment-like); villas/townhouses use the house (building) number only. */
export const UNIT_REQUIRED: Schemas["PropertyType"][] = ["apartment", "duplex", "penthouse", "studio", "twin_house"];

export function enumOptions<V extends string>(values: readonly V[], ns: string, t: TFunction): Option<V>[] {
  const tr = t as unknown as (key: string) => string;
  return values.map((v) => ({ value: v, label: tr(`enum.${ns}.${v}`) }));
}
