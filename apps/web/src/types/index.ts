export type SystemRole = 'SUPER_ADMIN' | 'COMMUNITY_ADMIN' | 'DRIVER' | 'PASSENGER';
export type CommunityRole = 'HEAD' | 'ADMIN' | 'APPROVER' | 'OPERATOR';

export interface MyCommunity {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: CommunityRole;
  permissions: string[];
}

export interface Me {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  preferredLanguage: string;
  trustedContactName: string | null;
  trustedContactPhone: string | null;
  roles: SystemRole[];
  permissions: string[];
  communities: MyCommunity[];
  driver: { id: string; verificationStatus: string; status: string } | null;
}

export type LatLng = { lat: number; lng: number };

export type BookingStatus =
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'ARRIVING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NO_DRIVER_AVAILABLE'
  | 'NO_SHOW';

export interface FareLine {
  code: string;
  label: string;
  amountPaise: number;
}

export interface FareRule {
  id: string;
  version: number;
  serviceType: 'REGULAR' | 'SHARED';
  sharedRouteId: string | null;
  baseFarePaise: number;
  baseDistanceMeters: number;
  perKmPaise: number;
  minimumFarePaise: number;
  waitingPerMinutePaise: number;
  freeWaitingMinutes: number;
  perSeatPaise: number;
  perStopPaise: number;
  nightSurchargeBps: number;
  nightStartHour: number;
  nightEndHour: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PickupPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isStand: boolean;
  active?: boolean;
  description?: string | null;
}

export interface RouteStop {
  id: string;
  sequence: number;
  offsetMinutes: number;
  pickupPointId?: string;
  pickupPoint: { id?: string; name: string; lat: number; lng: number };
}

export interface Departure {
  id: string;
  departureAt: string;
  capacity: number;
  seatsAvailable: number;
  bookingClosesAt: string;
  vehicle: { registrationNumber: string } | null;
  route: { id: string; code: string; name: string; cancellationCutoffMinutes: number; boardingRules: string | null; pathGeometry: [number, number][] | null; stops: RouteStop[] };
}
