import { Component } from 'react';
import ErrorBanner from './ErrorBanner';

// Contains a rendering bug to the section it happened in. Before this existed,
// one undefined identifier in one panel blanked the entire app — an error
// boundary is what turns "the app broke" into "this card broke".
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Section failed to render:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorBanner className="mt-4">
          {this.props.label || 'This section'} hit a bug and couldn&rsquo;t render. The rest of the app is unaffected.
          <button
            onClick={() => this.setState({ error: null })}
            className="ml-2 underline cursor-pointer"
          >
            Try again
          </button>
        </ErrorBanner>
      );
    }
    return this.props.children;
  }
}
