import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://bzrxpejjfzlecpugylqx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cnhwZWpqZnpsZWNwdWd5bHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTkxNjksImV4cCI6MjA4NDgzNTE2OX0.tS3GgxA5L969XGQK9Uw4qxTcqco1Y2iytoKcfos0DNU";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

document.querySelector("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.querySelector("#email").value;
  const password = document.querySelector("#password").value;
  const btn = document.querySelector(".submit-btn");
  const originalText = btn.textContent;

  btn.textContent = "Authenticating...";
  btn.disabled = true;
  btn.style.opacity = "0.7";

  // 1️⃣ Login
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(error.message);
    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.opacity = "1";
    return;
  }

  const userId = data.user.id;

  // 2️⃣ Check hospital verification using the `verified` boolean column
  const { data: hospital, error: dbError } = await supabase
    .from("hospitals")
    .select("verified")
    .eq("id", userId)
    .single();

  if (dbError) {
    alert("Hospital profile not found. Please register first.");
    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.opacity = "1";
    return;
  }

  // 3️⃣ Access control: only verified === true hospitals can access
  if (hospital.verified === true) {
    window.location.href = `hospital.html?id=${userId}`;
    return;
  }

  // Not verified — show pending message
  alert("Your account is pending admin verification");
  btn.textContent = originalText;
  btn.disabled = false;
  btn.style.opacity = "1";
});
