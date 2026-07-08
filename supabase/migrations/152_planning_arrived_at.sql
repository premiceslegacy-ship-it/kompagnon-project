-- Arrivée sur site persistée en base (remplace le localStorage côté TourneeCard)
-- Permet à l'admin de retrouver l'état "arrivé, en attente de départ" depuis
-- n'importe quel appareil, et le rend potentiellement visible à l'intervenant.
ALTER TABLE public.chantier_plannings
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.chantier_plannings.arrived_at IS
  'Horodatage de pointage "Arrivée" en cours pour ce créneau de tournée, effacé une fois le pointage de départ enregistré dans chantier_pointages.';
