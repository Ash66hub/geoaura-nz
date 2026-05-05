import {
  DetailPanelModel,
} from '../detail-panel/detail-panel.component';
import { PropertySummary } from '../../../services/property.service';

interface BuildPropertyDetailModelArgs {
  propertyCoords: { lat: number; lng: number } | null;
  preferProperty: boolean;
  propertyLoading: boolean;
  summary: PropertySummary | null;
  propertyLoadError: string | null;
}

export function buildPropertyDetailModel(
  args: BuildPropertyDetailModelArgs,
): DetailPanelModel | null {
  const { propertyCoords, preferProperty, propertyLoading, summary, propertyLoadError } = args;
  if (!propertyCoords || !preferProperty) return null;

  if (propertyLoading) {
    return {
      id: 'property',
      title: 'Property Details',
      icon: 'home_pin',
      color: '#22c55e',
      sections: [
        {
          title: 'Loading Property Details',
          description: 'Fetching available property metadata for the selected location.',
          source: 'LINZ',
          symbol: 'hourglass_top',
          symbolColor: '#22c55e',
          loading: true,
        },
      ],
      coords: propertyCoords,
      propertyLoading: true,
    };
  }

  if (summary) {
    const propertyType = derivePropertyType(summary);
    const address = summary.address?.full_address ?? 'Unknown';
    const ta = summary.address?.territorial_authority ?? 'Unknown';
    const titleNo = summary.title?.title_no ?? 'Unknown';
    const landDistrict = summary.title?.land_district ?? 'Unknown';
    const titleType = summary.title?.type ?? 'Unknown';
    const appellation = summary.parcel?.appellation ?? 'Unknown';
    const area = formatPropertyValue(summary.parcel?.area);
    const parcelPurpose = normalizeParcelPurpose(summary.parcel?.purpose);
    const council = summary.location?.council ?? 'Unknown';
    const taId = formatPropertyValue(summary.location?.ta_id);

    const qvLink = 'https://www.qv.co.nz/property-search/';
    const homesLink = 'https://homes.co.nz/';

    return {
      id: 'property',
      title: 'Property Details',
      icon: 'home_pin',
      color: '#22c55e',
      sections: [
        {
          title: 'Property Type',
          description: `${propertyType}. `,
          source: 'LINZ',
          symbol: 'home_work',
          symbolColor: '#22c55e',
        },
        {
          title: 'Address',
          description: `${address}. Territorial Authority: ${ta}.`,
          source: 'LINZ',
          symbol: 'location_on',
          symbolColor: '#38bdf8',
        },
        {
          title: 'Title And Parcel',
          description: `Title: ${titleNo} (${landDistrict}). Title Type: ${titleType}. Appellation: ${appellation}. Area: ${area}. Purpose: ${parcelPurpose}.`,
          source: 'LINZ',
          symbol: 'description',
          symbolColor: '#a78bfa',
        },
        {
          title: 'Building Profile & Valuation',
          description:
            'Building profile fields are currently sparse in source data. Use these external listings for richer property context.',
          links: [
            { label: 'QV Property Search', href: qvLink },
            { label: 'Homes.co.nz', href: homesLink },
          ],
          source: 'LINZ',
          symbol: 'apartment',
          symbolColor: '#f97316',
        },
        {
          title: 'Administrative Area',
          description: `Council: ${council}. TA ID: ${taId}.`,
          source: 'LINZ',
          symbol: 'account_balance',
          symbolColor: '#facc15',
        },
      ],
      coords: propertyCoords,
    };
  }

  if (propertyLoadError) {
    return {
      id: 'property',
      title: 'Property Details',
      icon: 'home_pin',
      color: '#22c55e',
      sections: [
        {
          title: 'No Property Data Available',
          description: propertyLoadError || 'Property details are unavailable for this location.',
          source: 'LINZ',
          symbol: 'info',
          symbolColor: '#94a3b8',
        },
      ],
      coords: propertyCoords,
    };
  }

  return null;
}

function derivePropertyType(summary: PropertySummary): string {
  const explicitType = summary.title?.type?.trim();
  if (explicitType && explicitType.toLowerCase() !== 'unknown') {
    return explicitType;
  }

  const use = summary.building?.use?.toLowerCase() ?? '';
  const riskClass = summary.building?.risk_class?.toLowerCase() ?? '';
  const normalizedPurpose = normalizeParcelPurpose(summary.parcel?.purpose);
  const purpose = normalizedPurpose.toLowerCase();
  const combined = `${use} ${riskClass} ${purpose}`;

  if (combined.includes('vacant') || combined.includes('bare') || combined.includes('empty')) {
    return 'Vacant Land';
  }

  if (
    combined.includes('multi') ||
    combined.includes('apartment') ||
    combined.includes('unit') ||
    combined.includes('townhouse') ||
    combined.includes('flat')
  ) {
    return 'Multi-unit Residential';
  }

  if (
    combined.includes('residential') ||
    combined.includes('house') ||
    combined.includes('dwelling') ||
    combined.includes('home')
  ) {
    return 'Residential House';
  }

  if (combined.includes('commercial') || combined.includes('retail') || combined.includes('office')) {
    return 'Commercial Property';
  }

  if (combined.includes('industrial') || combined.includes('warehouse')) {
    return 'Industrial Property';
  }

  return summary.building?.use || normalizedPurpose || 'Unknown';
}

function normalizeParcelPurpose(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 'Unknown';
  }

  if (trimmed.toUpperCase() === 'DCDB') {
    return 'Unknown';
  }

  return trimmed;
}

function formatPropertyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || `${value}`.trim() === '') {
    return 'Unknown';
  }
  return `${value}`;
}