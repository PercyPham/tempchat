package config

import (
	"os"
	"strconv"
)

// Payment returns the loaded payment configuration.
func Payment() paymentConfig { ensureConfigLoaded(); return payment }

var payment paymentConfig

type paymentConfig struct {
	PolarAccessToken      string
	PolarWebhookSecret    string // base64-encoded HMAC-SHA256 key
	PolarPriceIDBoostPlus string
	PolarPriceIDBoostPro  string
	SepayWebhookAPIKey    string
	SepayAccountNumber    string
	SepayBankCode         string
	BoostPlusVND          int64
	BoostProVND           int64
	AppBaseURL            string // e.g. "https://app.tempchat.io"
}

func loadPaymentConfig() {
	payment = paymentConfig{
		PolarAccessToken:      getEnv("POLAR_ACCESS_TOKEN", ""),
		PolarWebhookSecret:    getEnv("POLAR_WEBHOOK_SECRET", ""),
		PolarPriceIDBoostPlus: getEnv("POLAR_PRICE_ID_BOOST_PLUS", ""),
		PolarPriceIDBoostPro:  getEnv("POLAR_PRICE_ID_BOOST_PRO", ""),
		SepayWebhookAPIKey:    getEnv("SEPAY_WEBHOOK_API_KEY", ""),
		SepayAccountNumber:    getEnv("SEPAY_ACCOUNT_NUMBER", ""),
		SepayBankCode:         getEnv("SEPAY_BANK_CODE", ""),
		BoostPlusVND:          parseInt64Env("BOOST_PLUS_VND", 20000),
		BoostProVND:           parseInt64Env("BOOST_PRO_VND", 50000),
		AppBaseURL:            getEnv("APP_BASE_URL", "https://app.tempchat.io"),
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
