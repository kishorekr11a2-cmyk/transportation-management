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

            document.getElementById("excelFile").value = "";

        } catch (error) {

            console.log(error);

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
                    Excel Upload
                </h1>

                <p style={styles.subtitle}>
                    Upload Student Excel Data into MongoDB
                </p>

                <label
                    htmlFor="excelFile"
                    style={styles.fileBox}
                >

                    Select Excel File

                    <input
                        id="excelFile"
                        type="file"
                        accept=".xlsx,.xls"
                        style={styles.input}
                        onChange={(e) => setFile(e.target.files[0])}
                    />

                </label>

                {
                    file &&
                    (
                        <div style={styles.selected}>
                            ✅ {file.name}
                        </div>
                    )
                }

                <button
                    style={
                        loading
                            ? styles.disabledBtn
                            : styles.uploadBtn
                    }
                    disabled={loading}
                    onClick={handleUpload}
                >
                    {
                        loading
                            ? "Uploading..."
                            : "Upload Excel"
                    }
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

        position: "relative"

    },

    backBtn: {

        position: "absolute",

        top: "25px",

        left: "25px",

        padding: "10px 20px",

        border: "none",

        borderRadius: "8px",

        background: "#ffffff",

        color: "#2563eb",

        cursor: "pointer",

        fontWeight: "600",

        boxShadow: "0 5px 15px rgba(0,0,0,0.12)"

    },

    card: {

        width: "420px",

        background: "#ffffff",

        padding: "40px",

        borderRadius: "20px",

        textAlign: "center",

        boxShadow: "0 15px 35px rgba(0,0,0,0.12)"

    },

    icon: {

        fontSize: "55px",

        marginBottom: "15px"

    },

    title: {

        color: "#1e293b",

        marginBottom: "10px"

    },

    subtitle: {

        color: "#64748b",

        marginBottom: "30px"

    },

    fileBox: {

        display: "block",

        padding: "20px",

        border: "2px dashed #2563eb",

        borderRadius: "12px",

        cursor: "pointer",

        color: "#2563eb",

        fontWeight: "600",

        marginBottom: "20px"

    },

    input: {

        display: "none"

    },

    selected: {

        background: "#eff6ff",

        color: "#1e40af",

        padding: "12px",

        borderRadius: "8px",

        marginBottom: "20px"

    },

    uploadBtn: {

        width: "100%",

        padding: "14px",

        border: "none",

        borderRadius: "10px",

        background: "#2563eb",

        color: "#ffffff",

        fontSize: "16px",

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

        fontSize: "16px",

        cursor: "not-allowed"

    }

};

export default ExcelUpload;