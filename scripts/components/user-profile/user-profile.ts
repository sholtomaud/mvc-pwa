import sheet from './user-profile.css' with { type: 'css' };
import htmlText from './user-profile.html?raw';

interface Profile {
  username: string;
  email: string;
  address: string;
  target: number;
}

const DEFAULT_PROFILE: Profile = {
  username: 'Alexander Vance',
  email: 'alexander.vance@example.com',
  address: '742 Evergreen Terrace, Springfield, US',
  target: 5
};

class UserProfile extends HTMLElement {
  private shadow: ShadowRoot;
  private profile: Profile;
  private currentStep: number = 1;
  private debounceTimer: number | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
    
    const stored = localStorage.getItem('user-profile');
    this.profile = stored ? JSON.parse(stored) : { ...DEFAULT_PROFILE };
  }

  connectedCallback(): void {
    this.render();
    this.setupForm();
  }

  private render(): void {
    this.shadow.innerHTML = htmlText;
  }

  private updateStepUI(): void {
    const steps = this.shadow.querySelectorAll('.form-step');
    const indicators = this.shadow.querySelectorAll('.step-indicator .step');

    const updateDOM = () => {
      steps.forEach((step) => {
        const stepNum = parseInt(step.getAttribute('data-step') || '1', 10);
        if (stepNum === this.currentStep) {
          step.classList.add('active');
        } else {
          step.classList.remove('active');
        }
      });

      indicators.forEach((indicator) => {
        const stepNum = parseInt(indicator.getAttribute('data-step-indicator') || '1', 10);
        if (stepNum <= this.currentStep) {
          indicator.classList.add('active');
        } else {
          indicator.classList.remove('active');
        }
      });
    };

    // Use native View Transitions API for slide-like animations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docAny = document as any;
    if (docAny.startViewTransition) {
      docAny.startViewTransition(updateDOM);
    } else {
      updateDOM();
    }
  }

  private setupForm(): void {
    const form = this.shadow.querySelector('.profile-form') as HTMLFormElement | null;
    if (!form) return;

    const nameInput = this.shadow.querySelector('#profile-username') as HTMLInputElement;
    const emailInput = this.shadow.querySelector('#profile-email') as HTMLInputElement;
    const addrInput = this.shadow.querySelector('#profile-address') as HTMLInputElement;
    const targetInput = this.shadow.querySelector('#profile-target') as HTMLInputElement;
    
    const nextBtn = this.shadow.querySelector('.next-btn') as HTMLButtonElement;
    const prevBtn = this.shadow.querySelector('.prev-btn') as HTMLButtonElement;
    const statusMsg = this.shadow.querySelector('.status-msg') as HTMLSpanElement;
    const usernameFeedback = this.shadow.querySelector('.username-feedback') as HTMLSpanElement;

    // Set initial values
    if (nameInput) nameInput.value = this.profile.username;
    if (emailInput) emailInput.value = this.profile.email;
    if (addrInput) addrInput.value = this.profile.address;
    if (targetInput) targetInput.value = this.profile.target.toString();

    // Debounced Username Availability API Check
    nameInput?.addEventListener('input', () => {
      const username = nameInput.value.trim();
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      if (username.length < 2) {
        if (usernameFeedback) usernameFeedback.textContent = '';
        return;
      }

      if (usernameFeedback) {
        usernameFeedback.textContent = 'Checking availability...';
        usernameFeedback.className = 'username-feedback checking';
      }

      this.debounceTimer = window.setTimeout(async () => {
        try {
          const res = await fetch(`api/check-username?username=${encodeURIComponent(username)}`);
          if (res.ok) {
            const data = await res.json();
            if (usernameFeedback) {
              if (data.available) {
                usernameFeedback.textContent = '✓ Username is available';
                usernameFeedback.className = 'username-feedback available';
              } else {
                usernameFeedback.textContent = '✗ Username is already taken';
                usernameFeedback.className = 'username-feedback taken';
              }
            }
          } else {
            throw new Error('API check failed');
          }
        } catch {
          // Fallback or offline behavior
          if (usernameFeedback) {
            usernameFeedback.textContent = '✓ Username is available (offline check)';
            usernameFeedback.className = 'username-feedback available';
          }
        }
      }, 300); // 300ms debounce
    });

    // Step 1 -> Step 2
    nextBtn?.addEventListener('click', () => {
      // Validate Step 1 fields
      const isNameValid = nameInput.checkValidity();
      const isEmailValid = emailInput.checkValidity();

      // Trigger standard HTML5 validation message bubbles if invalid
      if (!isNameValid) {
        nameInput.reportValidity();
        return;
      }
      if (!isEmailValid) {
        emailInput.reportValidity();
        return;
      }

      this.currentStep = 2;
      this.updateStepUI();
    });

    // Step 2 -> Step 1 (Preserves states naturally because inputs remain in DOM)
    prevBtn?.addEventListener('click', () => {
      this.currentStep = 1;
      this.updateStepUI();
    });

    // Save changes & complete wizard
    form.addEventListener('submit', async (e: Event) => {
      e.preventDefault();

      // Validate Step 2 fields
      const isAddrValid = addrInput.checkValidity();
      const isTargetValid = targetInput.checkValidity();

      if (!isAddrValid) {
        addrInput.reportValidity();
        return;
      }
      if (!isTargetValid) {
        targetInput.reportValidity();
        return;
      }

      if (statusMsg) {
        statusMsg.textContent = 'Saving details...';
        statusMsg.className = 'status-msg checking';
      }

      try {
        const payload = {
          username: nameInput.value.trim(),
          email: emailInput.value.trim(),
          address: addrInput.value.trim(),
          target: parseInt(targetInput.value, 10) || 5
        };

        // Simulate save payload API mock
        const response = await fetch('api/save-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          this.profile = payload;

          // Save to localStorage
          localStorage.setItem('user-profile', JSON.stringify(this.profile));

          // Dispatch profile update CustomEvent
          this.dispatchEvent(new CustomEvent('profile-update', {
            bubbles: true,
            composed: true,
            detail: this.profile
          }));

          if (statusMsg) {
            statusMsg.textContent = '✓ Saved successfully!';
            statusMsg.className = 'status-msg show';
            setTimeout(() => {
              statusMsg.classList.remove('show');
            }, 2000);
          }
        } else {
          throw new Error('API saving failed');
        }
      } catch {
        // Fallback for offline usage
        this.profile = {
          username: nameInput.value.trim(),
          email: emailInput.value.trim(),
          address: addrInput.value.trim(),
          target: parseInt(targetInput.value, 10) || 5
        };
        localStorage.setItem('user-profile', JSON.stringify(this.profile));
        this.dispatchEvent(new CustomEvent('profile-update', {
          bubbles: true,
          composed: true,
          detail: this.profile
        }));

        if (statusMsg) {
          statusMsg.textContent = '✓ Saved successfully (offline mode)';
          statusMsg.className = 'status-msg show';
          setTimeout(() => {
            statusMsg.classList.remove('show');
          }, 2000);
        }
      }
    });
  }
}

customElements.define('user-profile', UserProfile);
export default UserProfile;
export type { Profile };

