export interface UserFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  zipCode: string;
  streetAddress: string;
  city: string;
  county: string;
  state: string;
  precinct: string;
}

export interface PollingInfo {
  pollingPlaces: string;
  ballotItems: string;
  contests: string;
  sources: { uri: string; title: string }[];
}
