import "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    skipToast?: boolean;
    enableSuccessToast?: boolean;
    successMessage?: string;
  }

  interface InternalAxiosRequestConfig {
    skipToast?: boolean;
    enableSuccessToast?: boolean;
    successMessage?: string;
  }
}
