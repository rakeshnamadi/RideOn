/** Plain-language summary of each union role, shown wherever roles are assigned. */
export const UNION_ROLE_LABELS: Record<string, string> = {
  LOCAL_ADMIN: 'Local admin',
  REPORTER: 'Reporter',
  APPROVER: 'Approver',
  OPERATOR: 'Operator',
};

export const UNION_ROLE_HELP: Record<string, string> = {
  LOCAL_ADMIN: 'Runs the union for its area: drivers, prices, pickup and drop points, master data and the team.',
  REPORTER: 'Prepares, views and edits reports, approves new drivers, and sets area geolocation.',
  APPROVER: 'Votes on fare proposals and answers drivers’ fare feedback.',
  OPERATOR: 'Runs the live stand queue and departures, and handles bookings and complaints.',
};

export const PLATFORM_ROLE_HELP: Record<string, string> = {
  SUPER_ADMIN: 'Control over everything: assigns roles, and can update or delete any configured data.',
  COMMUNITY_ADMIN: 'Can open the console of each union they hold a role in.',
  DRIVER: 'Driver console: trips, earnings, fare feedback and tickets. Needs a driver registration.',
  PASSENGER: 'Can book rides.',
};
