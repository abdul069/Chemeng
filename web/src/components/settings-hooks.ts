/** Eén instelling (of enkele) bewaren met een korte bevestiging. Gedeeld door Instellingen en de losse instellingenblokken. */
import { api } from "../api";
import { useAction } from "../store";

export function useSetting() {
  const act = useAction();
  return (values: Record<string, string | number | boolean>, msg = "Bewaard") => act(() => api.put("/settings", values), msg);
}
