import os
import glob
import re

def main():
    test_files = glob.glob("testsprite_tests/TC*.py")
    
    # Replace xpath=/html/body/div/div/main/section[\d+] with xpath=//section[contains(@class, 'active')]
    pattern = re.compile(r"xpath=/html/body/div(?:\[\d+\])?/div/main/section\[\d+\]")
    replacement = "xpath=//section[contains(@class, \\\"active\\\")]"
    
    for f in test_files:
        with open(f, "r", encoding="utf-8") as file:
            content = file.read()
            
        new_content, count = pattern.subn(replacement, content)
        if count > 0:
            with open(f, "w", encoding="utf-8") as file:
                file.write(new_content)
            print(f"Fixed {count} XPaths in {f}")

if __name__ == "__main__":
    main()
