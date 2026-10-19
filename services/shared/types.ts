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
  geo: GeoPoint;
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
