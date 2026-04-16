import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://bzrxpejjfzlecpugylqx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cnhwZWpqZnpsZWNwdWd5bHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTkxNjksImV4cCI6MjA4NDgzNTE2OX0.tS3GgxA5L969XGQK9Uw4qxTcqco1Y2iytoKcfos0DNU";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- File Upload Zone Interaction ---
const uploadZone = document.getElementById("uploadZone");
const fileInput = document.getElementById("licenseFile");
const fileNameDisplay = document.getElementById("fileName");

uploadZone.addEventListener("click", () => fileInput.click());

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    fileInput.files = files;
    handleFileSelect(files[0]);
  }
});

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

function handleFileSelect(file) {
  // Validate file type
  if (file.type !== "application/pdf") {
    showStatus("Only PDF files are allowed.", "error");
    fileInput.value = "";
    return;
  }

  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    showStatus("File size must be under 5MB.", "error");
    fileInput.value = "";
    return;
  }

  fileNameDisplay.textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  uploadZone.classList.add("has-file");
  hideStatus();
}

// --- Status Messages ---
function showStatus(message, type) {
  const el = document.getElementById("statusMsg");
  el.textContent = message;
  el.className = `status-msg ${type}`;
}

function hideStatus() {
  const el = document.getElementById("statusMsg");
  el.className = "status-msg";
}

// --- Form Submission ---
document.querySelector("#hospitalForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const btn = document.getElementById("submitBtn");
  const originalText = btn.textContent;

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const name = document.querySelector("#name").value.trim();
  const address = document.querySelector("#address").value.trim();
  const city = document.querySelector("#city").value.trim();
  const contact = document.querySelector("#contact").value.trim();
  const type = document.querySelector("#type").value;
  const licenseNumber = document.querySelector("#licenseNumber").value.trim();
  const licenseFile = document.querySelector("#licenseFile").files[0];

  // Validate license file
  if (!licenseFile) {
    showStatus("Please upload your license document (PDF).", "error");
    return;
  }

  if (licenseFile.type !== "application/pdf") {
    showStatus("License document must be a PDF file.", "error");
    return;
  }

  if (licenseFile.size > 5 * 1024 * 1024) {
    showStatus("License file must be under 5MB.", "error");
    return;
  }

  // Disable button
  btn.textContent = "Creating account...";
  btn.disabled = true;
  btn.style.opacity = "0.7";

  try {
    // 1️⃣ Create auth account
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      showStatus(error.message, "error");
      btn.textContent = originalText;
      btn.disabled = false;
      btn.style.opacity = "1";
      return;
    }

    if (!data?.user) {
      showStatus("Registration failed. Please try again.", "error");
      btn.textContent = originalText;
      btn.disabled = false;
      btn.style.opacity = "1";
      return;
    }

    const userId = data.user.id;

    // 2️⃣ Upload license PDF to Supabase Storage
    btn.textContent = "Uploading license document...";

    const fileExt = "pdf";
    const filePath = `${userId}/license_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("hospital-licenses")
      .upload(filePath, licenseFile, {
        contentType: "application/pdf",
        upsert: false
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      showStatus("Failed to upload license document: " + uploadError.message, "error");
      btn.textContent = originalText;
      btn.disabled = false;
      btn.style.opacity = "1";
      return;
    }

    // 3️⃣ (Skip public URL, only store file path)

    // 4️⃣ Create hospital profile with verified = false (pending approval)
    btn.textContent = "Saving hospital profile...";

    console.log("Storing hospital with email:", email);
    if (!email) {
      console.error("Email is missing at insertion step.");
    }

    const { error: dbError } = await supabase.from("hospitals").insert({
      id: userId,
      name,
      address,
      city,
      contact_number: contact,
      type,
      license_number: licenseNumber,
      license_file_url: filePath,
      email,
      verified: false,
      created_at: new Date().toISOString()
    });

    if (dbError) {
      console.error("DB error:", dbError);
      showStatus("Failed to save hospital profile: " + dbError.message, "error");
      btn.textContent = originalText;
      btn.disabled = false;
      btn.style.opacity = "1";
      return;
    }

    // 5️⃣ Log audit event
    await supabase.from("audit_logs").insert({
      hospital_id: userId,
      action_type: "HOSPITAL_REGISTERED",
      description: `New hospital "${name}" registered. License: ${licenseNumber}. Awaiting admin approval.`
    });

    // 6️⃣ Show success message
    document.getElementById("hospitalForm").style.display = "none";
    showStatus(
      "✅ Registration submitted successfully!\n\nYour account is pending admin approval. You will be able to log in once an administrator has verified your license and approved your registration.",
      "pending"
    );
    const statusEl = document.getElementById("statusMsg");
    statusEl.style.whiteSpace = "pre-line";

    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.opacity = "1";

  } catch (err) {
    console.error("Registration error:", err);
    showStatus("An unexpected error occurred. Please try again.", "error");
    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.opacity = "1";
  }
});
