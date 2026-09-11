#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# S24 Ultra — Active Cellular Number Extraction Script
# Extracts current SIM/cellular phone number for Twilio SMS wakeup integration.
# ==============================================================================
set -u

echo "============================================================"
echo "  SAMSUNG S24 ULTRA — CELLULAR NUMBER EXTRACTION"
echo "  Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "============================================================"

DISCOVERED_NUMBERS=""

add_number() {
    local raw="$1"
    local source="$2"
    # Clean non-digits except leading +
    local clean
    clean=$(echo "$raw" | tr -d ' \t\r\n()-')
    
    # Extract 10 digit Indian number if present
    if [[ "$clean" =~ [6-9][0-9]{9} ]]; then
        local match="${BASH_REMATCH[0]}"
        local e164="+91$match"
        echo "[+] Found from $source: $e164 (Raw: $raw)"
        DISCOVERED_NUMBERS="$DISCOVERED_NUMBERS $e164"
    fi
}

echo ""
echo "[1/5] Checking Termux:API Telephony Info..."
if command -v termux-telephony-deviceinfo >/dev/null 2>&1; then
    TEL_JSON=$(termux-telephony-deviceinfo 2>/dev/null || true)
    if [[ -n "$TEL_JSON" ]]; then
        PNUM=$(echo "$TEL_JSON" | grep -o '"phone_number": *"[^"]*"' | cut -d'"' -f4 || true)
        OPERATOR=$(echo "$TEL_JSON" | grep -o '"sim_operator_name": *"[^"]*"' | cut -d'"' -f4 || true)
        NET_TYPE=$(echo "$TEL_JSON" | grep -o '"network_type": *"[^"]*"' | cut -d'"' -f4 || true)
        echo "    SIM Operator : ${OPERATOR:-Unknown}"
        echo "    Network Type : ${NET_TYPE:-Unknown}"
        if [[ -n "$PNUM" && "$PNUM" != "null" ]]; then
            add_number "$PNUM" "termux-telephony-deviceinfo"
        fi
    fi
else
    echo "    termux-telephony-deviceinfo not found or permissions missing."
fi

echo ""
echo "[2/5] Checking Android Telephony Registry (dumpsys)..."
DUMPSYS_OUT=$(dumpsys telephony.registry 2>/dev/null || true)
if [[ -n "$DUMPSYS_OUT" ]]; then
    LINES=$(echo "$DUMPSYS_OUT" | grep -iE 'mline1number|phonenumber|msisdn' | head -n 10 || true)
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            add_number "$line" "dumpsys telephony.registry"
        fi
    done <<< "$LINES"
else
    echo "    dumpsys restricted (standard for non-root/non-adb Termux)."
fi

echo ""
echo "[3/5] Scanning Carrier SMS Messages for Account/Recharge Numbers..."
# Query via Termux API or Android Content Provider
SMS_DUMP=""
if command -v termux-sms-list >/dev/null 2>&1; then
    SMS_DUMP=$(termux-sms-list -l 30 2>/dev/null || true)
fi
if [[ -z "$SMS_DUMP" ]]; then
    SMS_DUMP=$(content query --uri content://sms --projection address,body --limit 30 2>/dev/null || true)
fi

if [[ -n "$SMS_DUMP" ]]; then
    # Look for Jio messages or SMS containing self-number mentions
    MATCHED_SMS=$(echo "$SMS_DUMP" | grep -iE 'jio|recharge|balance|plan|number|mobile|otp' || true)
    while IFS= read -r line; do
        # Look for numbers in typical carrier format
        NUMS=$(echo "$line" | grep -oE '\b[6-9][0-9]{9}\b' || true)
        for n in $NUMS; do
            add_number "$n" "Carrier SMS Context"
        done
    done <<< "$MATCHED_SMS"
else
    echo "    SMS content provider not accessible directly."
fi

echo ""
echo "[4/5] Checking Android Owner Profile & Contacts..."
PROFILE_NUM=$(content query --uri content://com.android.contacts/profile/data --projection data1 2>/dev/null | grep -oE '[6-9][0-9]{9}' | head -n 1 || true)
if [[ -n "$PROFILE_NUM" ]]; then
    add_number "$PROFILE_NUM" "Android Profile"
fi

echo ""
echo "[5/5] Checking WhatsApp Registered Identity (if present)..."
for WA_PATH in "/data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml" \
               "/data/user/0/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml"; do
    if [[ -r "$WA_PATH" ]]; then
        WA_JID=$(grep -o 'registration_jid"[^>]*>[0-9]*' "$WA_PATH" 2>/dev/null | grep -oE '[0-9]+' || true)
        if [[ -n "$WA_JID" ]]; then
            add_number "$WA_JID" "WhatsApp Registration"
        fi
    fi
done

echo ""
echo "============================================================"
echo "  EXTRACTION RESULTS"
echo "============================================================"

# Unique numbers
UNIQUE_NUMBERS=$(echo "$DISCOVERED_NUMBERS" | tr ' ' '\n' | grep -v '^$' | sort -u)

if [[ -z "$UNIQUE_NUMBERS" ]]; then
    echo "[!] No active phone number could be automatically read from SIM/system."
    echo ""
    echo "Common reasons on Jio/Indian SIMs:"
    echo "  1. Jio SIM cards do not write the MSISDN to the SIM hardware chip."
    echo "  2. Termux does not have READ_PHONE_STATE permission granted."
    echo ""
    echo "To fix & get number immediately:"
    echo "  - In Termux, grant permissions: termux-telephony-deviceinfo (tap allow on phone screen)"
    echo "  - Or dial *1# or 1299 from the phone (Jio will SMS the number instantly)"
    echo "  - Or open Settings -> About Phone -> 'Phone number'"
else
    echo "[*] Discovered active cellular number(s):"
    for num in $UNIQUE_NUMBERS; do
        echo "    -> E.164: $num  (Ready for Twilio)"
    done
fi
echo "============================================================"
