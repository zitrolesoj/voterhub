import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Vote, 
  MapPin, 
  ClipboardList, 
  User, 
  Mail, 
  Phone, 
  Building2, 
  Map, 
  Globe, 
  ArrowRight, 
  Loader2, 
  ChevronLeft,
  ExternalLink,
  UserCheck,
  Github,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import Markdown from 'react-markdown';
import { UserFormData, PollingInfo } from './types';
import { getVoterInformation } from './services/geminiService';
import { fetchVoterInfoFromGoogle } from './services/googleCivicService';
import { STATES, TEXAS_COUNTIES } from './constants';

export default function App() {
  const [formData, setFormData] = useState<UserFormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dob: '',
    zipCode: '',
    streetAddress: '',
    city: '',
    county: 'Williamson',
    state: 'Texas',
    precinct: '',
  });

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PollingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [githubAuth, setGithubAuth] = useState(false);

  const performSync = async () => {
    setSyncing(true);
    setSyncSuccess(false);
    setError(null);

    try {
      const res = await fetch('/api/github/sync', { 
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 5000);
      } else {
        const errorMsg = data.error || 'Failed to sync';
        if (errorMsg.includes('secondary rate limit')) {
          setError('GitHub is temporarily limiting requests. Please wait 5-10 minutes before trying again.');
        } else {
          setError(errorMsg);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sync with GitHub');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    // Check GitHub auth status on mount
    fetch('/api/auth/github/status', { credentials: 'include' })
      .then(res => res.json())
      .then(data => setGithubAuth(data.authenticated));

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        setGithubAuth(true);
        performSync();
      } else if (event.data?.type === 'GITHUB_AUTH_ERROR') {
        setError(`GitHub Auth Error: ${event.data.error} - ${event.data.description}`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGithubSync = async () => {
    if (!githubAuth) {
      try {
        const res = await fetch('/api/auth/github/url');
        const data = await res.json();
        
        if (!res.ok) {
          setError(data.error || 'Failed to get GitHub authentication URL');
          return;
        }
        
        if (data.url) {
          window.open(data.url, 'github_oauth', 'width=600,height=700');
        } else {
          setError('GitHub authentication URL not found in server response');
        }
        return;
      } catch (err) {
        setError('Failed to initiate GitHub authentication. Please check your connection.');
        return;
      }
    }

    await performSync();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const newData = { ...prev, [name]: value };
      
      // If state changes to Texas, set default county to Williamson
      if (name === 'state' && value === 'Texas') {
        newData.county = 'Williamson';
      } else if (name === 'state' && value !== 'Texas') {
        // Clear county if not Texas, as we don't have other state county lists
        newData.county = '';
      }
      
      return newData;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let currentPrecinct = formData.precinct;

      // Fetch additional context from Google Civic API if possible
      let googleCivicData = null;
      if (formData.zipCode && (formData.streetAddress || formData.city)) {
        try {
          const civicInfo = await fetchVoterInfoFromGoogle(formData);
          if (civicInfo) {
            googleCivicData = civicInfo;
          }
        } catch (civicErr: any) {
          // Log but don't block the search
          console.warn("Civic API unavailable, proceeding with search fallback:", civicErr.message);
        }
      }

      const data = await getVoterInformation({ ...formData, precinct: currentPrecinct }, googleCivicData);
      setResults(data);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setResults(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-sans selection:bg-[#5A5A40] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#1A1A1A]/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-[#5A5A40] p-2 rounded-xl">
              <Vote className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Voter Hub</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleGithubSync}
              disabled={syncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                syncSuccess 
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' 
                  : 'bg-[#F5F5F0] hover:bg-[#5A5A40]/10 text-[#1A1A1A] border border-[#1A1A1A]/5'
              }`}
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : syncSuccess ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Github className="w-4 h-4" />
              )}
              {syncing ? 'Syncing...' : syncSuccess ? 'Synced!' : 'Sync to GitHub'}
            </button>
            {results && (
              <button 
                onClick={handleBack}
                className="flex items-center gap-2 text-sm font-medium hover:text-[#5A5A40] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Form
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {error && (
          <div className="mb-8 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
        <AnimatePresence mode="wait">
          {!results ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <h2 className="text-4xl font-serif font-medium leading-tight">
                  Find Your Polling Place & <br />
                  <span className="italic text-[#5A5A40]">Preview Your Ballot</span>
                </h2>
                <p className="text-[#1A1A1A]/60 max-w-xl">
                  Enter your details below to get personalized information about upcoming elections in your area.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-8 rounded-[32px] shadow-sm border border-[#1A1A1A]/5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <User className="w-3 h-3" /> First Name
                  </label>
                  <input
                    required
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    placeholder="JOSE"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <User className="w-3 h-3" /> Last Name
                  </label>
                  <input
                    required
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    placeholder="ORTIZ"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <ClipboardList className="w-3 h-3" /> Date of Birth
                  </label>
                  <input
                    required
                    type="date"
                    name="dob"
                    value={formData.dob}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> Street Address
                  </label>
                  <input
                    required
                    type="text"
                    name="streetAddress"
                    value={formData.streetAddress}
                    onChange={handleInputChange}
                    placeholder="123 Main St"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> Zip Code
                  </label>
                  <input
                    required
                    type="text"
                    name="zipCode"
                    value={formData.zipCode}
                    onChange={handleInputChange}
                    placeholder="78717"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <Mail className="w-3 h-3" /> Email Address
                  </label>
                  <input
                    required
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="jane@example.com"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <Phone className="w-3 h-3" /> Phone Number
                  </label>
                  <input
                    required
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="(555) 000-0000"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <Building2 className="w-3 h-3" /> City
                  </label>
                  <input
                    required
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleInputChange}
                    placeholder="San Francisco"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <Globe className="w-3 h-3" /> State
                  </label>
                  <select
                    required
                    name="state"
                    value={formData.state}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option value="">Select State</option>
                    {STATES.map(state => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <Map className="w-3 h-3" /> County
                  </label>
                  {formData.state === 'Texas' ? (
                    <select
                      required
                      name="county"
                      value={formData.county}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none appearance-none cursor-pointer"
                    >
                      <option value="">Select County</option>
                      {TEXAS_COUNTIES.map(county => (
                        <option key={county} value={county}>{county}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      required
                      type="text"
                      name="county"
                      value={formData.county}
                      onChange={handleInputChange}
                      placeholder="Enter County"
                      className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                    <ClipboardList className="w-3 h-3" /> Precinct (Optional)
                  </label>
                  <input
                    type="text"
                    name="precinct"
                    value={formData.precinct}
                    onChange={handleInputChange}
                    placeholder="Auto-filled if found"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F5F0] border-transparent focus:bg-white focus:border-[#5A5A40] focus:ring-0 transition-all outline-none"
                  />
                  <p className="text-[10px] text-[#1A1A1A]/40 italic">We'll try to look this up automatically for Texas voters.</p>
                </div>

                <div className="md:col-span-2 pt-4">
                  <button
                    disabled={loading}
                    className="w-full bg-[#5A5A40] text-white py-4 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-[#4A4A30] transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Searching for information...
                      </>
                    ) : (
                      <>
                        Get My Voter Info
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-3xl font-serif font-medium">Your Voter Information</h2>
                  <p className="text-[#1A1A1A]/60">
                    Based on your location in {formData.city}, {formData.state} (Precinct: {formData.precinct})
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-8">
                {/* Polling Information */}
                <div className="bg-white p-8 rounded-[32px] shadow-sm border border-[#1A1A1A]/5">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-[#5A5A40]/10 rounded-lg">
                      <MapPin className="w-5 h-5 text-[#5A5A40]" />
                    </div>
                    <h3 className="text-xl font-serif font-medium">Polling Locations</h3>
                  </div>
                  <div className="markdown-body prose prose-stone max-w-none prose-headings:font-serif prose-headings:font-medium prose-headings:text-[#1A1A1A] prose-p:text-[#1A1A1A]/80 prose-li:text-[#1A1A1A]/80">
                    <Markdown>{results.pollingPlaces}</Markdown>
                  </div>
                </div>

                {/* Contests & Candidates */}
                {results.contests && (
                  <div className="bg-white p-8 rounded-[32px] shadow-sm border border-[#1A1A1A]/5">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 bg-[#5A5A40]/10 rounded-lg">
                        <UserCheck className="w-5 h-5 text-[#5A5A40]" />
                      </div>
                      <h3 className="text-xl font-serif font-medium">Contests & Candidates</h3>
                    </div>
                    <div className="markdown-body prose prose-stone max-w-none prose-headings:font-serif prose-headings:font-medium prose-headings:text-[#1A1A1A] prose-p:text-[#1A1A1A]/80 prose-li:text-[#1A1A1A]/80">
                      <Markdown>{results.contests}</Markdown>
                    </div>
                  </div>
                )}

                {/* Sources */}
                {results.sources.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 flex items-center gap-2">
                      <Globe className="w-3 h-3" /> Information Sources
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {results.sources.map((source, idx) => (
                        <a
                          key={idx}
                          href={source.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#1A1A1A]/5 hover:border-[#5A5A40] transition-all group"
                        >
                          <span className="text-sm font-medium truncate pr-4">{source.title}</span>
                          <ExternalLink className="w-4 h-4 text-[#1A1A1A]/40 group-hover:text-[#5A5A40] transition-colors flex-shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-[#1A1A1A]/10 text-center">
        <p className="text-sm text-[#1A1A1A]/40">
          This information is provided for educational purposes. Always verify with your local election board.
        </p>
      </footer>
    </div>
  );
}
