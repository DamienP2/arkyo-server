export type UserDetail = {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  clientNumber: string | null;
  isActive: boolean;
  deletedAt: string | null;
  ssoProvider: string | null;
  ssoId: string | null;
  locale: string;
  createdAt: string;
  lastLogin: string | null;
  profile: {
    civility: "MR" | "MME" | "MX" | "OTHER" | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    company: string | null;
    jobTitle: string | null;
    avatarUrl: string | null;
  } | null;
  memberships: Array<{
    id: string;
    role: string;
    /** Clé RBAC du rôle custom (null pour anciennes données → fallback enum). */
    roleKey: string | null;
    /** Libellé réel du rôle (custom si roleKey, sinon enum FR). */
    roleLabel: string;
    /** Couleur réelle du rôle (custom si roleKey, sinon enum). */
    roleColor: string;
    status: string;
    createdAt: string;
    acceptedAt: string | null;
    tenant: {
      id: string;
      slug: string;
      name: string;
      status: string;
      logoUrl: string | null;
      plan: string;
      trialEndsAt: string | null;
      courtesyPlan: string | null;
      courtesyEndsAt: string | null;
      createdAt: string;
    };
  }>;
  billing: {
    accountType: "INDIVIDUAL" | "FREELANCER" | "COMPANY" | "NONPROFIT";
    legalName: string | null;
    legalForm: string | null;
    siret: string | null;
    vatNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    region: string | null;
    country: string;
    currency: string;
    invoiceLanguage: string;
    paymentMethod: string | null;
    vatExempt: boolean;
    reverseCharge: boolean;
    internalNotes: string | null;
  } | null;
};

export type TabId = "identity" | "tenants" | "billing" | "activity";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
