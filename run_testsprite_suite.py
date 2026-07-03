import os
import subprocess
import glob
import sys

def main():
    test_files = sorted(glob.glob("testsprite_tests/TC*.py"))
    
    print("=" * 60)
    print("RUNNING TESTSPRITE AUTOMATED SUITE")
    print("=" * 60)
    
    results = {}
    
    for f in test_files:
        basename = os.path.basename(f)
        print(f"Running {basename}...", end="", flush=True)
        
        try:
            # Run the test case script
            proc = subprocess.run([sys.executable, f], capture_output=True, text=True, timeout=60)
            if proc.returncode == 0:
                print(" \033[92mPASSED\033[0m")
                results[basename] = "PASSED"
            else:
                print(" \033[91mFAILED\033[0m")
                results[basename] = "FAILED"
                # print(proc.stderr) # uncomment for debugging
        except subprocess.TimeoutExpired:
            print(" \033[93mTIMEOUT\033[0m")
            results[basename] = "TIMEOUT"
        except Exception as e:
            print(" \033[91mERROR\033[0m")
            results[basename] = f"ERROR: {str(e)}"
            
    print("\n" + "=" * 60)
    print("TESTSPRITE SUITE SUMMARY")
    print("=" * 60)
    for test, status in results.items():
        print(f"{test:<60}: {status}")
    print("=" * 60)

if __name__ == "__main__":
    main()
