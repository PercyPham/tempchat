package config

import (
	"os"
	"strconv"
)

// Payment returns the loaded payment configuration.
func Payment() paymentConfig { ensureConfigLoaded(); return payment }

var payment paymentConfig

type paymentConfig struct {
	PolarAccessToken        string
	PolarWebhookSecret      string // base64-encoded HMAC-SHA256 key
	PolarProductIDBoostPlus string
	PolarProductIDBoostPro  string
	PolarEnv                string // "production" or "sandbox"
	SepayWebhookAPIKey      string // SePay webhook auth key (Apikey header)
	SepayAccountNumber      string // SePay bank account number (returned to frontend)
	SepayBankCode           string // SePay bank code (returned to frontend)
	BoostPlusVND            int64
	BoostProVND             int64
	AppBaseURL              string // e.g. "https://app.tempchat.app"
}

func loadPaymentConfig() {
	payment = paymentConfig{
		PolarAccessToken:        getEnv("POLAR_ACCESS_TOKEN", ""),
		PolarWebhookSecret:      getEnv("POLAR_WEBHOOK_SECRET", ""),
		PolarProductIDBoostPlus: getEnv("POLAR_PRODUCT_ID_BOOST_PLUS", ""),
		PolarProductIDBoostPro:  getEnv("POLAR_PRODUCT_ID_BOOST_PRO", ""),
		PolarEnv:                getEnv("POLAR_ENV", "production"),
		SepayWebhookAPIKey:      getEnv("SEPAY_WEBHOOK_API_KEY", ""),
		SepayAccountNumber:      getEnv("SEPAY_ACCOUNT_NUMBER", ""),
		SepayBankCode:           getEnv("SEPAY_BANK_CODE", ""),
		BoostPlusVND:            parseInt64Env("BOOST_PLUS_VND", 20000),
		BoostProVND:             parseInt64Env("BOOST_PRO_VND", 50000),
		AppBaseURL:              getEnv("APP_BASE_URL", "https://app.tempchat.app"),
	}
}

func parseInt64Env(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}
