
export type Frequency = 'monthly' | 'half' | 'yearly';

export interface CalculationResult {
  pliAge: number;
  term: number;
  sumAssured: number;
  maturityAge: number;
  frequency: Frequency;
  paymentText: string;
  basePremium: number;
  saRebatePerMonth: number;
  totalRebateForFrequency: number;
  finalPremium: number;
  bonusRate: number;
  bonusPerYear: number;
  totalBonus: number;
  maturityAmount: number;
  totalPremiumPaid: number;
  returns: number;
  dob: string;
}

export interface PremiumTable {
  [age: number]: {
    [maturity: number]: number;
  };
}
