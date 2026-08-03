export interface AuthActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly fieldErrors?: Record<string, string[]>;
}

export const initialAuthActionState: AuthActionState = { status: "idle" };
