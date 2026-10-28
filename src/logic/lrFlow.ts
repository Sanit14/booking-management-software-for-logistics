// The order Enter walks through the LR form (the card's order). The page lists these fields in the same order.
export const LR_ENTER_ORDER = [
  'consignor', 'consignee', 'toStation', 'particular', 'qty', 'toPay', 'paid', 'chargeOption',
  'godownBhada', 'godownInsurance', 'deliveryCharges', 'hamali', 'wasuli', 'staxPercent',
] as const;

/** Before the first field on the page; Enter walks past them (data-skip-enter), Shift+Tab and a click reach them. */
export const LR_SKIPPED = ['date', 'fromStation'] as const;
