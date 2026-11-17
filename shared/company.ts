// Fixed in the app, never a setting: the two lines every printout and the sidebar carry (DM's `company.ts`: "set once, never changed"), and the
// station every new LR starts from. No address, phone or GSTIN lines (DM prints none).
export const COMPANY_NAME = 'Sundeep Freight Movers';
export const COMPANY_LOCATION = 'Yavatmal';
/** The From station of every new LR. The keeper makes sure it exists and is active (`ensureBookingStation`). */
export const BOOKING_STATION = 'Yavatmal';
