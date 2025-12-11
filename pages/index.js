import { useEffect } from "react";
import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to about page
    router.push("/about");
  }, [router]);

  return null;
}
