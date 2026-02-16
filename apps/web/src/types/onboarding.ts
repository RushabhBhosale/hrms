export type OnboardingStatus =
  | "INTERVIEW"
  | "INTERVIEWED"
  | "OFFER_SENT"
  | "OFFER_ACCEPTED";

export type OnboardingCandidate = {
  id: string;
  name: string;
  email: string;
  status: OnboardingStatus;
  notes?: string;
  lastEmailSubject?: string;
  lastEmailBody?: string;
  lastEmailSentAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const ONBOARDING_STATUS_OPTIONS: {
  value: OnboardingStatus;
  label: string;
}[] = [
  { value: "INTERVIEW", label: "Interview" },
  { value: "INTERVIEWED", label: "Interviewed" },
  { value: "OFFER_SENT", label: "Offer sent" },
  { value: "OFFER_ACCEPTED", label: "Offer accepted" },
];
