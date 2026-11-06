
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

const recipients = [
  "info@pricomaviationparts.com",
  "sales@pricomaviationparts.com",
  "infosales@pricomaviationparts.com",
];

const fields = [
  "name",
  "company",
  "email",
  "phone",
  "street_address",
  "address_line2",
  "city",
  "state",
  "zip",
  "country",
  "requirements",
] as const;

type FormField = (typeof fields)[number];

const required: FormField[] = [
  "name",
  "company",
  "email",
  "street_address",
  "city",
  "state",
  "zip",
  "country",
  "requirements",
];

const labels: Record<FormField, string> = {
  name: "Full Name",
  company: "Company",
  email: "Email",
  phone: "Phone",
  street_address: "Street Address",
  address_line2: "Address Line 2",
  city: "City",
  state: "State / Province",
  zip: "ZIP / Postal Code",
  country: "Country",
  requirements: "Requirements / Comments",
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Get Cloudflare environment secrets
    const apiKey = env.RESEND_API_KEY;
    const turnstileSecret = env.TURNSTILE_SECRET_KEY;

    if (!apiKey || !turnstileSecret) {
      console.error("Required API secrets are missing.");

      return Response.json(
        {
          success: false,
          message: "Email service is not configured.",
        },
        { status: 500 }
      );
    }

    // 2. Read submitted form data
    const formData = await request.formData();

    const data = Object.fromEntries(
      fields.map((field) => [
        field,
        formData.get(field)?.toString().trim() ?? "",
      ])
    ) as Record<FormField, string>;

    // 3. Validate required fields
    if (required.some((field) => !data[field])) {
      return Response.json(
        {
          success: false,
          message: "Please complete all required fields.",
        },
        { status: 400 }
      );
    }

    // 4. Validate email address
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ||
      /[\r\n]/.test(data.email)
    ) {
      return Response.json(
        {
          success: false,
          message: "Please enter a valid email address.",
        },
        { status: 400 }
      );
    }

    // 5. Limit field lengths
    if (fields.some((field) => data[field].length > 5000)) {
      return Response.json(
        {
          success: false,
          message: "One or more fields are too long.",
        },
        { status: 400 }
      );
    }

    // 6. Verify Cloudflare Turnstile token
    const turnstileToken = formData
      .get("cf-turnstile-response")
      ?.toString();

    if (!turnstileToken) {
      return Response.json(
        {
          success: false,
          message: "Please complete the security verification.",
        },
        { status: 400 }
      );
    }

    const verificationResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          secret: turnstileSecret,
          response: turnstileToken,
          remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
        }),
      }
    );

    if (!verificationResponse.ok) {
      console.error("Turnstile verification service error.");

      return Response.json(
        {
          success: false,
          message: "Security verification failed. Please try again.",
        },
        { status: 502 }
      );
    }

    const verification = (await verificationResponse.json()) as {
      success: boolean;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (!verification.success) {
      console.error(
        "Turnstile verification failed:",
        verification["error-codes"]
      );

      return Response.json(
        {
          success: false,
          message:
            "Security verification failed. Please refresh and try again.",
        },
        { status: 403 }
      );
    }

    // 7. Prepare email content
    const rows = fields
      .map(
        (field) => `
          <tr>
            <td style="padding:10px;border:1px solid #ddd">
              <strong>${labels[field]}</strong>
            </td>
            <td style="padding:10px;border:1px solid #ddd;white-space:pre-wrap">
              ${escapeHtml(data[field]) || "—"}
            </td>
          </tr>
        `
      )
      .join("");

    // 8. Send email through Resend
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PRICOM Quote Form <quotes@pricomaviationparts.com>",
        to: recipients,
        reply_to: data.email,
        subject: "New Quotation Request - PRICOM Aviation Parts",
        html: `
          <h2>New Request for Quotation</h2>
          <p>A customer submitted a quotation request.</p>
          <table style="border-collapse:collapse;width:100%">
            ${rows}
          </table>
        `,
      }),
    });

    if (!response.ok) {
      console.error(
        "Resend API error:",
        response.status,
        await response.text()
      );

      return Response.json(
        {
          success: false,
          message: "Unable to send your request. Please try again later.",
        },
        { status: 502 }
      );
    }

    // 9. Return success
    return Response.json({
      success: true,
      message: "Your quotation request has been sent successfully.",
    });
  } catch (error) {
    console.error("Quote submission error:", error);

    return Response.json(
      {
        success: false,
        message: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }
};
