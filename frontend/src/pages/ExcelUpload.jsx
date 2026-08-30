import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../services/api";

function ExcelUpload() {
    const navigate = useNavigate();

    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);

    // ===============================
    // Upload Excel
    // ===============================
    const handleUpload = async () => {
        if (!file) {
            toast.error("Please select an Excel file");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        try {
            setLoading(true);

            const response = await api.post(
                "/excel/upload",
                formData,
                {
                    headers: {
                        "Content-Type": "multipart/form-data"
                    }
                }
            );

            toast.success(
                response.data.message || "Excel Uploaded Successfully"
            );

            setFile(null);
            const fileInput = document.getElementById("excelFile");
            if (fileInput) fileInput.value = "";

        } catch (error) {
            console.error("Upload Error:", error);
            toast.error(
                error.response?.data?.message || "Upload Failed"
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={styles.container}>
            <button className="back-btn" onClick={() => navigate(-1)}>
                ← Back
            </button>

            <div style={styles.card}>
                <div style={styles.icon}>
                    📄
                </div>

                <h1 style={styles.title}>
                    Excel User Import
                </h1>

                <p style={styles.subtitle}>
                    Import User Dataset into MongoDB for AI Route Optimization
                </p>

                {/* Required Columns Info */}
                <div style={styles.formatBox}>
                    <div style={styles.formatHeader}>
                        Required Excel Columns:
                    </div>
                    <div style={styles.columnsText}>
                        userId, name, stoppings, city, state, country
                    </div>
                </div>

                <label
                    htmlFor="excelFile"
                    style={styles.fileBox}
                >
                    Select Excel File (.xlsx / .xls)
                    <input
                        id="excelFile"
                        type="file"
                        accept=".xlsx,.xls"
                        style={styles.input}
                        onChange={(e) => setFile(e.target.files[0])}
                    />
                </label>

                {file && (
                    <div style={styles.selected}>
                        ✅ {file.name}
                    </div>
                )}

                <button
                    style={loading ? styles.disabledBtn : styles.uploadBtn}
                    disabled={loading}
                    onClick={handleUpload}
                >
                    {loading ? "Uploading & Syncing..." : "Upload & Sync to MongoDB"}
                </button>
            </div>
        </div>
    );
}

const styles = {
    container: {
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f8fafc",
        fontFamily: "Segoe UI, sans-serif",
        position: "relative",
        padding: "20px"
    },

    card: {
        width: "440px",
        maxWidth: "100%",
        background: "#ffffff",
        padding: "36px",
        borderRadius: "20px",
        textAlign: "center",
        boxShadow: "0 15px 35px rgba(0,0,0,0.12)"
    },

    icon: {
        fontSize: "50px",
        marginBottom: "12px"
    },

    title: {
        color: "#1e293b",
        marginBottom: "8px",
        fontSize: "24px"
    },

    subtitle: {
        color: "#64748b",
        marginBottom: "20px",
        fontSize: "14px"
    },

    formatBox: {
        background: "#f1f5f9",
        borderRadius: "10px",
        padding: "12px 16px",
        marginBottom: "20px",
        textAlign: "center"
    },

    formatHeader: {
        fontSize: "12px",
        fontWeight: "700",
        color: "#475569",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: "4px"
    },

    columnsText: {
        fontSize: "13px",
        color: "#1e293b",
        fontWeight: "600",
        wordBreak: "break-word"
    },

    fileBox: {
        display: "block",
        padding: "20px",
        border: "2px dashed #2563eb",
        borderRadius: "12px",
        cursor: "pointer",
        color: "#2563eb",
        fontWeight: "600",
        marginBottom: "18px",
        background: "#f8faff"
    },

    input: {
        display: "none"
    },

    selected: {
        background: "#eff6ff",
        color: "#1e40af",
        padding: "10px",
        borderRadius: "8px",
        marginBottom: "18px",
        fontSize: "13px"
    },

    uploadBtn: {
        width: "100%",
        padding: "14px",
        border: "none",
        borderRadius: "10px",
        background: "#2563eb",
        color: "#ffffff",
        fontSize: "15px",
        fontWeight: "600",
        cursor: "pointer"
    },

    disabledBtn: {
        width: "100%",
        padding: "14px",
        border: "none",
        borderRadius: "10px",
        background: "#94a3b8",
        color: "#ffffff",
        fontSize: "15px",
        cursor: "not-allowed"
    }
};

export default ExcelUpload;