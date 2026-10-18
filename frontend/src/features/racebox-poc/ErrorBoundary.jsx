import { Component } from 'react';

// Small error boundary so a crash inside a screen (bad session, unexpected data)
// shows a message instead of leaving a blank page.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <section className="rb-card">
          <h2>Algo ha fallado</h2>
          <p className="rb-alert rb-alert-error">
            {String((this.state.error && this.state.error.message) || this.state.error)}
          </p>
          <button
            type="button"
            className="rb-btn rb-btn-primary"
            onClick={() => {
              this.setState({ error: null });
              if (this.props.onReset) this.props.onReset();
            }}
          >
            {this.props.resetLabel || 'Volver'}
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
