export type KraMetric = {
  label: string;
  target?: string;
  weight?: number;
};

export type Kra = {
  _id: string;
  company?: string;
  questionKey?: string;
  roleKey?: string;
  employee:
    | string
    | {
        _id?: string;
        id?: string;
        name?: string;
        email?: string;
        employeeId?: string;
      };
  title: string;
  description?: string;
  periodStart?: string;
  periodEnd?: string;
  metrics: KraMetric[];
  status?: "ACTIVE" | "CLOSED";
  selfReviewEnabled?: boolean;
  selfReviewOpenFrom?: string;
  selfReviewOpenTo?: string;
  createdBy?: string;
  createdAt?: string;
  selfReview?: {
    answer?: string;
    rating?: number;
    submittedAt?: string;
  };
  managerReview?: {
    manager?: string;
    rating?: number;
    comments?: string;
    submittedAt?: string;
  };
  adminReview?: {
    admin?: string;
    rating?: number;
    comments?: string;
    submittedAt?: string;
  };
};

export type AppraisalKraResult = {
  kra?: string | Kra;
  rating?: number;
  comments?: string;
};

export type Appraisal = {
  _id: string;
  company?: string;
  employee:
    | string
    | {
        _id?: string;
        id?: string;
        name?: string;
        email?: string;
        employeeId?: string;
      };
  periodStart?: string;
  periodEnd?: string;
  overallRating?: number;
  summary?: string;
  kraResults?: AppraisalKraResult[];
  createdBy?: string;
  createdAt?: string;
};
