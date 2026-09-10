declare module 'pokersolver' {
  export interface SolvedHand {
    name: string;
    descr: string;
    rank: number;
    cards: unknown[];
    cardPool: unknown[];
  }
  export const Hand: {
    solve(cards: string[]): SolvedHand;
    winners(hands: SolvedHand[]): SolvedHand[];
  };
}
