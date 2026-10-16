"""Laya Neural Shooting Arena Engine.
Runs the Laya deep learning model to output tactical stances and combat actions.
"""

import os
import sys
import random
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Force offline mode for local model
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')

import torch
import laya

ROOT_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT_DIR / "model" / "laya-english"

# Auto-select CUDA GPU, fall back to CPU
def _select_device():
    if torch.cuda.is_available():
        dev = 'cuda'
        name = torch.cuda.get_device_name(0)
        print(f"[*] GPU detected: {name} — using CUDA.")
    else:
        dev = 'cpu'
        print("[*] No GPU — using CPU.")
    return dev

COMPUTE_DEVICE = _select_device()

# Module-level game sense and taxonomy definitions
GAME_SENSE = (
    "Top-down 1v1 arena shooter. Crates block bullets and line of sight. "
    "Shots are instant and travel straight. Goal: reduce enemy HP to 0."
)

STANCES = {
    'aggressive_push': 'Enemy is exposed or weak. Close distance and keep firing.',
    'flank_and_outposition': 'Enemy is behind cover or no line of sight. Move around the crate to get a clear angle.',
    'suppressive_fire': 'Enemy position is known but no clean shot. Fire to pin them down.',
    'defensive_reposition': 'Ammo is empty or reload is needed. Break line of sight briefly, then re-engage.',
}

ACTIONS = {
    'shoot': 'Fire at the enemy. Requires line of sight and ammo.',
    'burst_fire': 'Fire 3 rapid shots. Best at close range with a clear shot.',
    'strafe_left': 'Move sideways left to dodge incoming bullets.',
    'strafe_right': 'Move sideways right to dodge incoming bullets.',
    'dash_to_cover': 'Run behind the nearest crate to avoid fire.',
    'reload': 'Reload the weapon. Only useful when ammo is low and not in open fire.',
}


def build_state(gs: dict) -> dict:
    """Build factual battle state dictionary for the neural encoder."""
    dist = gs.get('dist_to_player', 300)
    return {
        "situation": GAME_SENSE,
        "distance": "point-blank" if dist < 180 else "mid" if dist < 480 else "long",
        "distance_px": round(dist),
        "enemy_has_cover": bool(gs.get('player_in_cover', False)),
        "i_have_cover": bool(gs.get('laya_in_cover', False)),
        "my_hp_pct": round(gs.get('laya_hp', 100)),
        "my_ammo": int(gs.get('laya_ammo', 30)),
        "enemy_bullets_in_air": int(gs.get('bullets_in_air', 0)),
    }


def pick(probs: dict, valid: set, temp: float = 0.7) -> str:
    """Sample an action or stance from probabilities with temperature, restricted to valid options."""
    items = {k: max(probs.get(k, 1e-6), 1e-6) for k in valid if k in probs}
    if not items:
        return random.choice(list(valid)) if valid else 'aggressive_push'
    weights = [p ** (1.0 / max(temp, 0.01)) for p in items.values()]
    return random.choices(list(items.keys()), weights=weights)[0]


class LayaShooterEngine:
    """Neural decision engine for the top-down shooter."""

    def __init__(self, model_dir=str(MODEL_PATH)):
        print(f"[*] Initializing Laya Shooter Engine from {model_dir}...")
        if COMPUTE_DEVICE == 'cpu':
            torch.set_num_threads(3)
        self.agent = laya.load(model_dir, device=COMPUTE_DEVICE)
        self.defensive_start_time = None
        print(f"[+] Laya Neural Core loaded on {COMPUTE_DEVICE.upper()}!")

    def decide_shooter_move(self, game_state: dict) -> dict:
        """
        Laya's neural decision for the shooter game.

        1. Passes objective battlefield state and criteria to Laya.
        2. Samples from probability distributions instead of argmax.
        3. Enforces hard physical constraints and masks in Python.
        4. Couples stance and action to prevent contradictory moves.
        5. Controls stance stickiness (max 3s defensive reposition).
        """
        dist = game_state.get('dist_to_player', 300)
        player_in_cover = bool(game_state.get('player_in_cover', False))
        laya_in_cover = bool(game_state.get('laya_in_cover', False))
        laya_hp = float(game_state.get('laya_hp', 100))
        laya_ammo = int(game_state.get('laya_ammo', 30))
        bullets_in_air = int(game_state.get('bullets_in_air', 0))
        game_time = float(game_state.get('game_time', 0))

        # Reset defensive timer if game was restarted
        if self.defensive_start_time is not None and game_time < self.defensive_start_time:
            self.defensive_start_time = None

        state = build_state(game_state)
        questions = {
            'stance': {
                'type': 'choice',
                'instructions': 'Best tactical posture right now?',
                'criteria': STANCES,
            },
            'next_action': {
                'type': 'choice',
                'instructions': 'Best immediate action?',
                'criteria': ACTIONS,
            },
        }

        try:
            res = self.agent.system_one(state, questions)
            st = res['answers']['stance']
            ac = res['answers']['next_action']
            st_probs = st.get('probabilities', {st.get('choice', 'aggressive_push'): 1.0})
            ac_probs = ac.get('probabilities', {ac.get('choice', 'shoot'): 1.0})
        except Exception as e:
            print(f"[!] Neural inference error: {e}")
            st_probs = {'aggressive_push': 0.7, 'flank_and_outposition': 0.3}
            ac_probs = {'shoot': 0.6, 'burst_fire': 0.4}

        # ── 1. Stance constraints & stickiness control in code ─────────────────
        stance_valid = set(STANCES)
        # Defensive reposition is ONLY permissible when ammo is depleted/low
        if laya_ammo > 8:
            stance_valid.discard('defensive_reposition')

        # Limit defensive repositioning to max 3s unless completely empty on ammo
        if self.defensive_start_time is not None:
            if (game_time - self.defensive_start_time > 3.0) and laya_ammo > 0:
                stance_valid.discard('defensive_reposition')

        if not stance_valid:
            stance_valid = {'aggressive_push', 'flank_and_outposition'}

        # Sample stance from distribution
        chosen_stance = pick(st_probs, stance_valid, temp=0.7)

        # Track defensive posture duration
        if chosen_stance == 'defensive_reposition':
            if self.defensive_start_time is None:
                self.defensive_start_time = game_time
        else:
            self.defensive_start_time = None

        # ── 2. Action masking (impossible actions) ────────────────────────────
        valid_actions = set(ACTIONS)
        if laya_ammo >= 30:
            valid_actions.discard('reload')
        if laya_ammo == 0:
            valid_actions -= {'shoot', 'burst_fire'}
        # Suppressive fire can shoot to pin enemy even if enemy has cover
        if player_in_cover and chosen_stance != 'suppressive_fire':
            valid_actions -= {'shoot', 'burst_fire'}  # no clean direct line-of-sight

        # ── 3. Action-Stance coherence ────────────────────────────────────────
        if chosen_stance == 'defensive_reposition':
            # Defensive reposition does not fire into the open
            valid_actions -= {'shoot', 'burst_fire'}
        else:
            # Aggressive, flanking, and suppressive stances NEVER dash into hiding
            valid_actions.discard('dash_to_cover')

        if not valid_actions:
            if laya_ammo == 0:
                valid_actions = {'reload'}
            elif chosen_stance == 'defensive_reposition':
                valid_actions = {'dash_to_cover', 'strafe_left', 'strafe_right'}
            else:
                valid_actions = {'strafe_left', 'strafe_right'}

        # Sample action from distribution
        chosen_action = pick(ac_probs, valid_actions, temp=0.7)
        confidence = float(ac_probs.get(chosen_action, 0.7))

        aggression = {
            'aggressive_push': 0.95,
            'suppressive_fire': 0.65,
            'flank_and_outposition': 0.80,
            'defensive_reposition': 0.30,
        }.get(chosen_stance, 0.6)

        if chosen_action == 'reload' or laya_ammo == 0:
            should_shoot = False
        else:
            should_shoot = chosen_action in ('shoot', 'burst_fire')
        burst = (chosen_action == 'burst_fire')

        return {
            'stance': chosen_stance,
            'action': chosen_action,
            'action_probs': ac_probs,
            'confidence': confidence,
            'aggression': aggression,
            'should_shoot': should_shoot,
            'burst': burst,
            'device': COMPUTE_DEVICE,
        }
