export default function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <button className="close-btn" onClick={onClose}>✕</button>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}
