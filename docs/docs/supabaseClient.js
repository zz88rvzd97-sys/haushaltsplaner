import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const supabase = createClient(
  "https://jgwoeywqmrujlqigqzsr.supabase.co",
  "sb_publishable_mxpR76L6CEozXDR6e_CxFg_xKPVhtRr"
);

export function personalnummerZuEmail(personalnummer) {
  return `${String(personalnummer || "").trim()}@dienstplan.local`;
}
