import { UserFormData } from "../types";

export interface GoogleCivicVoterInfo {
  election?: {
    id: string;
    name: string;
    electionDay: string;
  };
  pollingLocations?: Array<{
    address: {
      locationName?: string;
      line1: string;
      city: string;
      state: string;
      zip: string;
    };
    notes?: string;
    pollingHours?: string;
    startDate?: string;
    endDate?: string;
  }>;
  contests?: Array<{
    type: string;
    office?: string;
    district?: {
      name: string;
      scope: string;
    };
    candidates?: Array<{
      name: string;
      party: string;
    }>;
    referendumTitle?: string;
    referendumSubtitle?: string;
  }>;
  normalizedInput?: {
    line1: string;
    city: string;
    state: string;
    zip: string;
  };
}

export async function fetchVoterInfoFromGoogle(userData: UserFormData): Promise<GoogleCivicVoterInfo | null> {
  // Construct a full address string for the Google API
  // Note: The more specific the address, the better the results.
  const address = `${userData.streetAddress}, ${userData.city}, ${userData.state} ${userData.zipCode}`;
  const url = `/api/civic/voterinfo?address=${encodeURIComponent(address)}`;

  try {
    const response = await fetch(url);
    const text = await response.text();
    
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn("Google Civic API returned non-JSON response:", text.substring(0, 100));
      return null;
    }

    if (!response.ok) {
      console.warn(`Google Civic API returned ${response.status}. Falling back to search.`);
      return null;
    }
    return data;
  } catch (error) {
    console.warn("Error fetching from Google Civic API (falling back to search):", error);
    return null;
  }
}
