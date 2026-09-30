//! The Stellar CLI built-in networks. The passphrase is the signing identity. The names are display text.

/// One built-in Stellar network.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Network {
    /// The Stellar CLI name, such as `testnet`.
    pub name: &'static str,
    /// The SEP-43 name: the Stellar SDK `Networks` key, such as `TESTNET`.
    pub sep43: &'static str,
    /// The name inside a sentence, such as "Stellar testnet".
    pub label: &'static str,
    pub passphrase: &'static str,
}

pub const TESTNET: &str = "Test SDF Network ; September 2015";

/// The Stellar CLI built-in networks, with the passphrases of the Stellar SDK `Networks` values.
pub const BUILT_IN: [Network; 4] = [
    Network { name: "testnet", sep43: "TESTNET", label: "Stellar testnet", passphrase: TESTNET },
    Network {
        name: "futurenet",
        sep43: "FUTURENET",
        label: "Stellar futurenet",
        passphrase: "Test SDF Future Network ; October 2022",
    },
    Network {
        name: "local",
        sep43: "STANDALONE",
        label: "a local Stellar network",
        passphrase: "Standalone Network ; February 2017",
    },
    Network {
        name: "mainnet",
        sep43: "PUBLIC",
        label: "Stellar mainnet",
        passphrase: "Public Global Stellar Network ; September 2015",
    },
];

/// The default network of `walleterm tunnel` and the only network of `walleterm demo`.
pub const DEFAULT: Network = BUILT_IN[0];

/// The built-in network with this Stellar CLI name.
pub fn named(name: &str) -> Option<Network> {
    BUILT_IN.into_iter().find(|n| n.name == name)
}

/// The built-in network with this exact passphrase.
pub fn of(passphrase: &str) -> Option<Network> {
    BUILT_IN.into_iter().find(|n| n.passphrase == passphrase)
}

/// The network of any other passphrase. A built-in passphrase resolves to its built-in network.
/// One process serves one network, so the one leaked passphrase and label stay bounded.
pub fn custom(passphrase: &str) -> Option<Network> {
    if !crate::util::valid_passphrase(passphrase) {
        return None;
    }
    of(passphrase).or_else(|| {
        let passphrase: &'static str = Box::leak(passphrase.to_owned().into_boxed_str());
        let label = Box::leak(format!("network {}", crate::cli::go_quote(passphrase)).into_boxed_str());
        Some(Network { name: "custom", sep43: "CUSTOM", label, passphrase })
    })
}

impl Network {
    /// Testnet, futurenet, and local networks hold no real value. Every other passphrase can.
    /// The tunnel asks for approval before each signature on every network that is not a test network.
    pub fn is_test(&self) -> bool {
        [TESTNET, BUILT_IN[1].passphrase, BUILT_IN[2].passphrase].contains(&self.passphrase)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn built_in_networks_match_their_documented_network_ids() {
        // docs/NETWORKS.md lists each network ID: SHA-256 of the passphrase.
        let ids = [
            ("testnet", "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472"),
            ("futurenet", "a3a1c6a78286713e29be0e9785670fa838d13917cd8eaeb4a3579ff1debc7fd5"),
            ("local", "baefd734b8d3e48472cff83912375fedbc7573701912fe308af730180f97d74a"),
            ("mainnet", "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979"),
        ];
        for (name, id) in ids {
            let network = named(name).unwrap();
            assert_eq!(crate::util::hex(&crate::util::sha256(network.passphrase.as_bytes())), id, "{name}");
            assert_eq!(of(network.passphrase), Some(network));
        }
        assert_eq!(DEFAULT.passphrase, TESTNET);
        assert_eq!(of("Walleterm ; offline"), None);
    }

    #[test]
    fn only_the_three_test_passphrases_are_test_networks() {
        for name in ["testnet", "futurenet", "local"] {
            assert!(named(name).unwrap().is_test(), "{name}");
        }
        assert!(!named("mainnet").unwrap().is_test());
        for name in ["pubnet", "public", "TESTNET", "", "custom"] {
            assert_eq!(named(name), None, "{name}");
        }
    }

    #[test]
    fn a_custom_passphrase_is_a_production_network_and_a_built_in_one_keeps_its_name() {
        let custom = custom("Walleterm ; offline").unwrap();
        assert_eq!(
            (custom.name, custom.sep43, custom.passphrase),
            ("custom", "CUSTOM", "Walleterm ; offline")
        );
        assert_eq!(custom.label, "network \"Walleterm ; offline\"");
        assert!(!custom.is_test());
        // The rule follows the passphrase, not the flag that named it.
        assert_eq!(super::custom(TESTNET), Some(DEFAULT));
        assert_eq!(super::custom(BUILT_IN[3].passphrase), named("mainnet"));
        // A near match is another network: no trimming, no case folding.
        assert!(!super::custom(" Test SDF Network ; September 2015").unwrap().is_test());
        for invalid in ["", " \t", &"x".repeat(257)] {
            assert_eq!(super::custom(invalid), None);
        }
    }
}
