import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AddressSuggestion, PropertyService } from '../../../services/property.service';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex?: number;
  results: {
    length: number;
    item(index: number): SpeechRecognitionResultLike;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

@Component({
  selector: 'app-address-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './address-search.component.html',
  styleUrls: ['./address-search.component.scss'],
})
export class AddressSearchComponent implements OnDestroy {
  private propertyService = inject(PropertyService);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);
  private searchDebounceId: ReturnType<typeof setTimeout> | null = null;
  private searchSub: Subscription | null = null;
  private requestId = 0;
  private isDestroyed = false;
  private speechRecognition: SpeechRecognitionLike | null = null;

  @ViewChild('addressInput') private addressInputRef?: ElementRef<HTMLInputElement>;

  @Output() addressSelected = new EventEmitter<AddressSuggestion>();

  query = '';
  suggestions: AddressSuggestion[] = [];
  highlightedIndex = -1;
  isLoading = false;
  showSuggestions = false;
  hasSearched = false;
  keepPanelOpen = false;
  isListening = false;
  speechSupported = false;

  constructor() {
    this.initSpeechRecognition();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    if (this.isListening) {
      this.speechRecognition?.stop();
    }
    if (this.searchDebounceId) {
      clearTimeout(this.searchDebounceId);
    }
    this.searchSub?.unsubscribe();
  }

  private requestRender() {
    // Ensure async callbacks (debounce/HTTP/speech) always refresh the dropdown view immediately.
    if (!this.isDestroyed) {
      this.cdr.detectChanges();
    }
  }

  onQueryChange(value: string) {
    this.query = value;
    this.highlightedIndex = -1;

    if (this.searchDebounceId) {
      clearTimeout(this.searchDebounceId);
    }

    if (value.trim().length < 2) {
      this.resetSuggestions();
      return;
    }

    this.showSuggestions = true;
    this.isLoading = true;
    this.hasSearched = false;
    this.suggestions = [];
    this.requestRender();

    this.searchDebounceId = setTimeout(() => {
      this.fetchSuggestions(value.trim());
    }, 250);
  }

  onSearchClick() {
    this.finalizeSelection(this.getActiveSuggestion());
  }

  onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && this.suggestions.length > 0) {
      event.preventDefault();
      this.highlightedIndex = Math.min(this.highlightedIndex + 1, this.suggestions.length - 1);
      return;
    }

    if (event.key === 'ArrowUp' && this.suggestions.length > 0) {
      event.preventDefault();
      this.highlightedIndex = Math.max(this.highlightedIndex - 1, 0);
      return;
    }

    if (event.key === 'Escape') {
      this.showSuggestions = false;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.finalizeSelection(this.getActiveSuggestion());
    }
  }

  onInputBlur() {
    // Do not force-close immediately; this avoids requiring a refocus click
    // when results arrive right after blur/DOM focus shifts.
    setTimeout(() => {
      if (!this.keepPanelOpen && !this.isLoading) {
        this.showSuggestions = false;
        this.requestRender();
      }
    }, 120);
  }

  onInputFocus() {
    if (
      this.query.trim().length >= 2 &&
      (this.suggestions.length > 0 || this.isLoading || this.hasSearched)
    ) {
      this.showSuggestions = true;
    }
  }

  onPanelPointerDown() {
    this.keepPanelOpen = true;
  }

  onPanelPointerUp() {
    this.keepPanelOpen = false;
  }

  onSuggestionSelect(suggestion: AddressSuggestion) {
    this.finalizeSelection(suggestion);
  }

  onMicClick() {
    if (!this.speechSupported || !this.speechRecognition) {
      return;
    }

    if (this.isListening) {
      this.speechRecognition.stop();
      return;
    }

    try {
      this.speechRecognition.start();
      this.isListening = true;
      this.requestRender();
    } catch {
      this.isListening = false;
      this.requestRender();
    }
  }

  onClearClick() {
    if (this.searchDebounceId) {
      clearTimeout(this.searchDebounceId);
      this.searchDebounceId = null;
    }

    this.searchSub?.unsubscribe();

    if (this.isListening) {
      this.speechRecognition?.stop();
    }

    this.query = '';
    this.resetSuggestions();
    this.syncInputValue('');
  }

  private fetchSuggestions(value: string) {
    this.searchSub?.unsubscribe();
    const activeRequestId = ++this.requestId;

    this.searchSub = this.propertyService.searchAddresses(value).subscribe({
      next: (results) => {
        if (activeRequestId !== this.requestId) return;
        this.suggestions = results;
        this.highlightedIndex = results.length > 0 ? 0 : -1;
        this.showSuggestions = true;
        this.isLoading = false;
        this.hasSearched = true;
        this.requestRender();
      },
      error: () => {
        if (activeRequestId !== this.requestId) return;
        this.resetSuggestions();
        this.isLoading = false;
        this.hasSearched = true;
        this.showSuggestions = true;
        this.requestRender();
      },
    });
  }

  private initSpeechRecognition() {
    const speechCtor = this.getSpeechRecognitionCtor();
    if (!speechCtor) {
      this.speechSupported = false;
      return;
    }

    this.speechSupported = true;
    const recognition = new speechCtor();
    recognition.lang = 'en-NZ';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      this.zone.run(() => {
        const transcript = this.extractTranscript(event);
        if (transcript) {
          this.applyTranscriptToInput(transcript);
          this.requestRender();
        }
      });
    };

    recognition.onerror = () => {
      this.zone.run(() => {
        this.isListening = false;
        this.requestRender();
      });
    };

    recognition.onend = () => {
      this.zone.run(() => {
        this.isListening = false;
        this.requestRender();
      });
    };

    this.speechRecognition = recognition;
  }

  private getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    const win = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }

  private extractTranscript(event: SpeechRecognitionEventLike): string {
    const start = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
    const chunks: string[] = [];

    for (let i = start; i < event.results.length; i++) {
      const result = event.results[i] ?? event.results.item(i);
      const alt = result?.[0] ?? result?.item(0);
      const text = alt?.transcript?.trim();
      if (text) {
        chunks.push(text);
      }
    }

    return chunks.join(' ').trim();
  }

  private syncInputValue(value: string) {
    const input = this.addressInputRef?.nativeElement;
    if (input) {
      input.value = value;
    }
  }

  private applyTranscriptToInput(transcript: string) {
    const input = this.addressInputRef?.nativeElement;
    if (!input) {
      this.query = transcript;
      this.onQueryChange(transcript);
      return;
    }

    // Drive Angular's existing ngModel/ngModelChange path exactly like user typing.
    input.value = transcript;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private getActiveSuggestion(): AddressSuggestion | null {
    if (this.suggestions.length === 0) {
      return null;
    }

    if (this.highlightedIndex >= 0 && this.highlightedIndex < this.suggestions.length) {
      return this.suggestions[this.highlightedIndex];
    }

    return this.suggestions[0];
  }

  private finalizeSelection(suggestion: AddressSuggestion | null) {
    if (!suggestion) {
      return;
    }

    this.query = suggestion.label;
    this.showSuggestions = false;
    this.addressSelected.emit(suggestion);
    this.requestRender();
  }

  private resetSuggestions() {
    this.suggestions = [];
    this.highlightedIndex = -1;
    this.showSuggestions = false;
    this.hasSearched = false;
    this.isLoading = false;
    this.requestRender();
  }
}
