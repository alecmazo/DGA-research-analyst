"""High-yield credit book. Identity comes from the SEC company ticker file.

No coupon, rating, price, or yield is stored here. A 3–4% investment-grade
coupon is not this book. The screen drops a bond once its yield is under 6%.
"""

from __future__ import annotations

YIELD_FLOOR_PCT = "6"
BOOK = "high_yield"

# ticker, 10-digit CIK, legal name, desk sector. CIKs matched to
# https://www.sec.gov/files/company_tickers.json on 2026-10-02.
UNIVERSE: tuple[dict, ...] = (
    {"ticker": "ACHC", "cik": "0001520697", "legal_name": "Acadia Healthcare Company Inc.", "sector": "Healthcare"},
    {"ticker": "ADNT", "cik": "0001670541", "legal_name": "Adient plc", "sector": "Industrials"},
    {"ticker": "AAP", "cik": "0001158449", "legal_name": "Advance Auto Parts Inc.", "sector": "Industrials"},
    {"ticker": "AFRM", "cik": "0001820953", "legal_name": "Affirm Holdings Inc.", "sector": "Specialty finance"},
    {"ticker": "AMC", "cik": "0001411579", "legal_name": "AMC Entertainment Holdings Inc.", "sector": "TMT"},
    {"ticker": "AAL", "cik": "0000006201", "legal_name": "American Airlines Group Inc.", "sector": "Leisure"},
    {"ticker": "AR", "cik": "0001433270", "legal_name": "Antero Resources Corp.", "sector": "Energy"},
    {"ticker": "CAR", "cik": "0000723612", "legal_name": "Avis Budget Group Inc.", "sector": "Consumer"},
    {"ticker": "AXTA", "cik": "0001616862", "legal_name": "Axalta Coating Systems Ltd.", "sector": "Chemicals"},
    {"ticker": "BHC", "cik": "0000885590", "legal_name": "Bausch Health Companies Inc.", "sector": "Healthcare"},
    {"ticker": "BLMN", "cik": "0001546417", "legal_name": "Bloomin' Brands Inc.", "sector": "Restaurants"},
    {"ticker": "EAT", "cik": "0000703351", "legal_name": "Brinker International Inc.", "sector": "Restaurants"},
    {"ticker": "CRC", "cik": "0001609253", "legal_name": "California Resources Corp.", "sector": "Energy"},
    {"ticker": "CLMT", "cik": "0002013745", "legal_name": "Calumet Inc.", "sector": "Energy"},
    {"ticker": "CPRI", "cik": "0001530721", "legal_name": "Capri Holdings Ltd.", "sector": "Consumer"},
    {"ticker": "CCL", "cik": "0000815097", "legal_name": "Carnival Corp. Ltd.", "sector": "Leisure"},
    {"ticker": "CVNA", "cik": "0001690820", "legal_name": "Carvana Co.", "sector": "Consumer"},
    {"ticker": "CHTR", "cik": "0001091667", "legal_name": "Charter Communications Inc.", "sector": "TMT"},
    {"ticker": "CAKE", "cik": "0000887596", "legal_name": "Cheesecake Factory Inc.", "sector": "Restaurants"},
    {"ticker": "CC", "cik": "0001627223", "legal_name": "Chemours Co.", "sector": "Chemicals"},
    {"ticker": "CNK", "cik": "0001385280", "legal_name": "Cinemark Holdings Inc.", "sector": "TMT"},
    {"ticker": "CCO", "cik": "0001334978", "legal_name": "Clear Channel Outdoor Holdings Inc.", "sector": "TMT"},
    {"ticker": "CYH", "cik": "0001108109", "legal_name": "Community Health Systems Inc.", "sector": "Healthcare"},
    {"ticker": "CRK", "cik": "0000023194", "legal_name": "Comstock Resources Inc.", "sector": "Energy"},
    {"ticker": "CBRL", "cik": "0001067294", "legal_name": "Cracker Barrel Old Country Store Inc.", "sector": "Restaurants"},
    {"ticker": "CACC", "cik": "0000885550", "legal_name": "Credit Acceptance Corp.", "sector": "Specialty finance"},
    {"ticker": "CVI", "cik": "0001376139", "legal_name": "CVR Energy Inc.", "sector": "Energy"},
    {"ticker": "PLAY", "cik": "0001525769", "legal_name": "Dave & Buster's Entertainment Inc.", "sector": "Restaurants"},
    {"ticker": "DVA", "cik": "0000927066", "legal_name": "DaVita Inc.", "sector": "Healthcare"},
    {"ticker": "DK", "cik": "0001694426", "legal_name": "Delek US Holdings Inc.", "sector": "Energy"},
    {"ticker": "DIN", "cik": "0000049754", "legal_name": "Dine Brands Global Inc.", "sector": "Restaurants"},
    {"ticker": "ECPG", "cik": "0001084961", "legal_name": "Encore Capital Group Inc.", "sector": "Specialty finance"},
    {"ticker": "ENVA", "cik": "0001529864", "legal_name": "Enova International Inc.", "sector": "Specialty finance"},
    {"ticker": "GT", "cik": "0000042582", "legal_name": "Goodyear Tire & Rubber Co.", "sector": "Industrials"},
    {"ticker": "GPK", "cik": "0001408075", "legal_name": "Graphic Packaging Holding Co.", "sector": "Chemicals"},
    {"ticker": "GPOR", "cik": "0000874499", "legal_name": "Gulfport Energy Corp.", "sector": "Energy"},
    {"ticker": "HTZ", "cik": "0001657853", "legal_name": "Hertz Global Holdings Inc.", "sector": "Consumer"},
    {"ticker": "HUN", "cik": "0001307954", "legal_name": "Huntsman Corp.", "sector": "Chemicals"},
    {"ticker": "IHRT", "cik": "0001400891", "legal_name": "iHeartMedia Inc.", "sector": "TMT"},
    {"ticker": "JACK", "cik": "0000807882", "legal_name": "Jack in the Box Inc.", "sector": "Restaurants"},
    {"ticker": "JBLU", "cik": "0001158463", "legal_name": "JetBlue Airways Corp.", "sector": "Leisure"},
    {"ticker": "KSS", "cik": "0000885639", "legal_name": "Kohl's Corp.", "sector": "Consumer"},
    {"ticker": "LYV", "cik": "0001335258", "legal_name": "Live Nation Entertainment Inc.", "sector": "Leisure"},
    {"ticker": "LUMN", "cik": "0000018926", "legal_name": "Lumen Technologies Inc.", "sector": "TMT"},
    {"ticker": "M", "cik": "0000794367", "legal_name": "Macy's Inc.", "sector": "Consumer"},
    {"ticker": "NBR", "cik": "0001163739", "legal_name": "Nabors Industries Ltd.", "sector": "Energy"},
    {"ticker": "NAVI", "cik": "0001593538", "legal_name": "Navient Corp.", "sector": "Specialty finance"},
    {"ticker": "NCLH", "cik": "0001513761", "legal_name": "Norwegian Cruise Line Holdings Ltd.", "sector": "Leisure"},
    {"ticker": "OI", "cik": "0000812074", "legal_name": "O-I Glass Inc.", "sector": "Chemicals"},
    {"ticker": "OLN", "cik": "0000074303", "legal_name": "Olin Corp.", "sector": "Chemicals"},
    {"ticker": "OMF", "cik": "0001584207", "legal_name": "OneMain Holdings Inc.", "sector": "Specialty finance"},
    {"ticker": "OGN", "cik": "0001821825", "legal_name": "Organon & Co.", "sector": "Healthcare"},
    {"ticker": "PZZA", "cik": "0000901491", "legal_name": "Papa Johns International Inc.", "sector": "Restaurants"},
    {"ticker": "PARR", "cik": "0000821483", "legal_name": "Par Pacific Holdings Inc.", "sector": "Energy"},
    {"ticker": "PTEN", "cik": "0000889900", "legal_name": "Patterson-UTI Energy Inc.", "sector": "Energy"},
    {"ticker": "PBF", "cik": "0001534504", "legal_name": "PBF Energy Inc.", "sector": "Energy"},
    {"ticker": "WOOF", "cik": "0001826470", "legal_name": "Petco Health & Wellness Company Inc.", "sector": "Consumer"},
    {"ticker": "PLNT", "cik": "0001637207", "legal_name": "Planet Fitness Inc.", "sector": "Leisure"},
    {"ticker": "RRC", "cik": "0000315852", "legal_name": "Range Resources Corp.", "sector": "Energy"},
    {"ticker": "RKT", "cik": "0001805284", "legal_name": "Rocket Companies Inc.", "sector": "Specialty finance"},
    {"ticker": "SIG", "cik": "0000832988", "legal_name": "Signet Jewelers Ltd.", "sector": "Consumer"},
    {"ticker": "SLGN", "cik": "0000849869", "legal_name": "Silgan Holdings Inc.", "sector": "Chemicals"},
    {"ticker": "SIRI", "cik": "0000908937", "legal_name": "Sirius XM Holdings Inc.", "sector": "TMT"},
    {"ticker": "FUN", "cik": "0001999001", "legal_name": "Six Flags Entertainment Corporation", "sector": "Leisure"},
    {"ticker": "SGRY", "cik": "0001638833", "legal_name": "Surgery Partners Inc.", "sector": "Healthcare"},
    {"ticker": "THC", "cik": "0000070318", "legal_name": "Tenet Healthcare Corp.", "sector": "Healthcare"},
    {"ticker": "TEVA", "cik": "0000818686", "legal_name": "Teva Pharmaceutical Industries Ltd.", "sector": "Healthcare"},
    {"ticker": "RIG", "cik": "0001451505", "legal_name": "Transocean Ltd.", "sector": "Energy"},
    {"ticker": "TROX", "cik": "0001530804", "legal_name": "Tronox Holdings plc", "sector": "Chemicals"},
    {"ticker": "PRKS", "cik": "0001564902", "legal_name": "United Parks & Resorts Inc.", "sector": "Leisure"},
    {"ticker": "UHS", "cik": "0000352915", "legal_name": "Universal Health Services Inc.", "sector": "Healthcare"},
    {"ticker": "UPBD", "cik": "0000933036", "legal_name": "Upbound Group Inc.", "sector": "Consumer"},
    {"ticker": "VFC", "cik": "0000103379", "legal_name": "VF Corp.", "sector": "Consumer"},
    {"ticker": "VAL", "cik": "0000314808", "legal_name": "Valaris Ltd.", "sector": "Energy"},
    {"ticker": "WBD", "cik": "0001437107", "legal_name": "Warner Bros. Discovery Inc.", "sector": "TMT"},
    {"ticker": "W", "cik": "0001616707", "legal_name": "Wayfair Inc.", "sector": "Consumer"},
    {"ticker": "WFRD", "cik": "0001603923", "legal_name": "Weatherford International plc", "sector": "Energy"},
    {"ticker": "WEN", "cik": "0000030697", "legal_name": "Wendy's Co.", "sector": "Restaurants"},
    {"ticker": "WH", "cik": "0001722684", "legal_name": "Wyndham Hotels & Resorts Inc.", "sector": "Leisure"},
    {"ticker": "XPO", "cik": "0001166003", "legal_name": "XPO Inc.", "sector": "Industrials"},
)


def by_cik(cik: str) -> dict | None:
    key = (cik or "").zfill(10)[-10:]
    for row in UNIVERSE:
        if row["cik"] == key:
            return row
    return None


def sectors() -> list[str]:
    return sorted({row["sector"] for row in UNIVERSE})

