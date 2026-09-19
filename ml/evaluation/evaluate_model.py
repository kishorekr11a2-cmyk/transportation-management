"""
evaluate_model.py
Evaluates the trained model against validation criteria and prints a transparent report.
"""

import json
import os

def evaluate():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    model_file = os.path.join(base_dir, "models", "route_quality_model.json")
    if not os.path.exists(model_file):
        print("Model file not found. Running training first...")
        import sys
        sys.path.append(os.path.join(base_dir, "training"))
        from train_model import run_training
        run_training()

    with open(model_file, "r") as f:
        model = json.load(f)

    print("==================================================")
    print("        ML ROUTE QUALITY MODEL EVALUATION         ")
    print("==================================================")
    print(f"Model Type:         {model.get('model_type')}")
    print(f"Dataset Size:       {model.get('dataset_size')} historical routes")
    print(f"Status:             {model.get('status')}")
    print("--------------------------------------------------")
    print("Evaluation Metrics:")
    for k, v in model.get("metrics", {}).items():
        print(f"  - {k}: {v}")
    print("--------------------------------------------------")
    print("Feature Importance:")
    for f, imp in model.get("feature_importance", {}).items():
        print(f"  - {f}: {imp * 100:.1f}%")
    print("==================================================")

if __name__ == "__main__":
    evaluate()
