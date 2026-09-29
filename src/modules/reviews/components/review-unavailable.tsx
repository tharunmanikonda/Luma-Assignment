import { signOutAction } from "@/infrastructure/auth/sign-in";
import styles from "./review.module.css";

export function ReviewUnavailable() {
  return (
    <main className={styles.unavailable}>
      <section>
        <p className={styles.eyebrow}>Maya Home Goods</p>
        <h1>Review unavailable</h1>
        <p>
          This review may belong to another account or may no longer be
          available.
        </p>
        <form action={signOutAction}>
          <button className={styles.primaryButton} type="submit">
            Sign out and switch account
          </button>
        </form>
      </section>
    </main>
  );
}
