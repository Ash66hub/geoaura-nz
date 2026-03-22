export interface GaugeProperties {
  OBJECTID: number;
  Siteno: number;
  Name: string;
  NZTM_E: number;
  NZTM_N: number;
  Region: string;
  Operator: string;
  Funder: string;
  Area_km2: number;
  No_years: number;
  L1_mean: number;
  L2: number;
  Lcv: number;
  T3_Lskew: number;
  T4_Lkurt: number;
  Gumb_u: number;
  Gumb_alpha: number;
  GEV_u: number;
  GEV_alpha: number;
  GEV_k: number;
  GEV_z: number;
  Data_2_33y: number;
  Data_5y: number;
  Data_10y: number;
  Data_20y: number;
  Data_50y: number;
  Data_100y: number;
  Data_250y: number;
  Data_500y: number;
  Data_1000y: number;
  se_2_33y: string;
  se_5y: string;
  se_10y: string;
  se_20y: string;
  se_50y: string;
  se_100y: string;
  se_250y: string;
  se_500y: string;
  se_1000y: string;
}

export interface LayerItem {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  colorClass: string;
  iconColorClass: string;
}
