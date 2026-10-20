export type RequestStatus =
  | 'RECEIVED'
  | 'REJECTED_SPAM'
  | 'PENDING_REVIEW'
  | 'MATCHING'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ACCEPTED'
  | 'PICKUP_PHOTO_CONFIRMED'
  | 'FRIDGE_MATCHED'
  | 'FRIDGE_PHOTO_CONFIRMED'
  | 'COMPLETE';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface FoodRequest {
  requestId: string;
  donorPhone: string;
  qty: string;
  foodType: string;
  /**
   * Optional on purpose: WhatsApp donors only have a geo when they send a location message.
   * Never default this to {lat:0,lng:0} — that silently anchors every distance calculation
   * to Null Island, making "nearest driver"/"nearest fridge" a constant function.
   */
  geo?: GeoPoint;
  /** Free-text address as extracted by the classifier, e.g. "Koramangala 5th Block". */
  locationText?: string;
  status: RequestStatus;
  driverId?: string;
  fridgeId?: string;
  createdAt: string;
  updatedAt: string;
  pickupPhotoUrl?: string;
  fridgePhotoUrl?: string;
  reassignCount: number;
  pendingTaskToken?: string;
  pendingStep?: 'ACCEPT' | 'PICKUP_PHOTO' | 'FRIDGE_PHOTO';
  lastInboundMessageId?: string;
  triedDriverIds?: string[];
  month?: string;
  /**
   * Set when a confident offer landed in PENDING_REVIEW only for lack of a geo, and the donor
   * was asked to share their location. Real WhatsApp sends a location share as its own webhook
   * delivery (no text), so the follow-up has to be matched back to this request by phone number
   * rather than arriving bundled with the original text like the dev simulator does.
   */
  awaitingLocation?: boolean;
}

export interface Driver {
  driverId: string;
  phone: string;
  name: string;
  currentGeo: GeoPoint;
  status: 'available' | 'busy';
  lastActive: string;
}

export interface Fridge {
  fridgeId: string;
  name: string;
  address: string;
  geo: GeoPoint;
  capacity: number;
}

export type ClassifierVerdict =
  | 'food_donation_offer'
  | 'spam'
  | 'marketing'
  | 'loan_offer'
  | 'unrelated';

export interface ClassifierResult {
  verdict: ClassifierVerdict;
  confidence: number;
  extracted?: {
    qty: string;
    foodType: string;
    locationText: string;
  };
}
