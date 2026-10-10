/**
 * The front, as the Army liaison lets us see it: where our line stands, how
 * bad the worst case is, how fast it is moving and what falls with it. Only
 * uses what the commander is told, never the true pressure.
 */
import { frontSector, SECTOR_PRESSURE, SECTORS, theaterDef } from './theaters';
import type { GameState, SideId, SideState, Site } from './types';

export type FrontLevel = 'steady' | 'strained' | 'critical';

export interface FrontOutlook {
  /** The liaison's figure, + favours us. */
  value: number;
  /** Where the line may really stand (the Intelligence Section's band, or the liaison's figure down to six points less: he runs optimistic). */
  range: [number, number];
  level: FrontLevel;
  /** True when a good week could break the enemy line. */
  chance: boolean;
  /** Points moved since last week (liaison's figures), or null with no history. */
  trend: number | null;
  /** Weeks until our sector falls if the trend continues from the worst case, or null if it is not heading that way. */
  weeksToFall: number | null;
  /** Our sector that goes first, and the sites that go with it. */
  atStake: { sector: string; sites: Site[] } | null;
  /** The enemy sector we would take, and its sites. */
  prize: { sector: string; sites: Site[] } | null;
  headline: string;
}

export function frontOutlook(state: GameState, side: SideState): FrontOutlook {
  const t = state.theater;
  const names = theaterDef(state).sectors;
  const value = side.perceived.front;
  const range: [number, number] = side.perceived.frontBand ?? [value - 6, value];
  const worst = range[0];
  const hist = side.perceived.frontHistory ?? [];
  const trend = hist.length >= 2 ? hist[hist.length - 1] - hist[hist.length - 2] : null;
  const level: FrontLevel = worst <= 10 - SECTOR_PRESSURE ? 'critical' : worst <= 16 - SECTOR_PRESSURE ? 'strained' : 'steady';
  const chance = range[1] >= SECTOR_PRESSURE - 10;
  const weeksToFall = trend !== null && trend < 0 && worst < 0 ? Math.max(1, Math.ceil((worst + SECTOR_PRESSURE) / -trend)) : null;
  const mine = frontSector(t, (1 - side.id) as SideId);
  const theirs = frontSector(t, side.id);
  const on = (sector: number) => t.sites.filter((s) => s.sector === sector);
  const atStake = mine >= 0 && mine < SECTORS ? { sector: names[mine], sites: on(mine) } : null;
  const prize = theirs >= 0 && theirs < SECTORS ? { sector: names[theirs], sites: on(theirs) } : null;
  const headline = level === 'critical'
    ? `${atStake?.sector ?? 'Our line'} may fall within a week`
    : level === 'strained'
      ? `${atStake?.sector ?? 'Our line'} is under strain${weeksToFall ? `, about ${weeksToFall} week${weeksToFall > 1 ? 's' : ''} at this pace` : ''}`
      : chance
        ? `${prize?.sector ?? 'The enemy line'} is wavering: a good week could break it`
        : 'The line is holding';
  return { value, range, level, chance, trend, weeksToFall, atStake, prize, headline };
}
